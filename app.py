# app.py
"""
Barrister AI — FastAPI Application
Advanced Legal Document Analysis Assistant
"""

import os
import sys
import traceback
import secrets
import logging

# Windows DLL fix for PyTorch
if sys.platform == "win32":
    possible_paths = [
        os.path.join(os.getcwd(), "venv", "Lib", "site-packages", "torch", "lib"),
        os.path.join(os.path.dirname(os.path.dirname(sys.executable)), "Lib", "site-packages", "torch", "lib")
    ]
    for lib_path in possible_paths:
        if os.path.exists(lib_path):
            try:
                os.add_dll_directory(lib_path)
            except Exception:
                pass

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Request, UploadFile, File, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.responses import JSONResponse, HTMLResponse
# pyrefly: ignore [missing-import]
from fastapi.staticfiles import StaticFiles
# pyrefly: ignore [missing-import]
from fastapi.templating import Jinja2Templates
# pyrefly: ignore [missing-import]
# pyrefly: ignore [missing-import]
from starlette.middleware.sessions import SessionMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
import uvicorn
import pickle

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase: 'Client' = None

try:
    # pyrefly: ignore [missing-import]
    from supabase import create_client, Client
    if SUPABASE_URL and SUPABASE_KEY and SUPABASE_KEY != 'your_supabase_anon_or_service_role_key':
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
except ImportError:
    pass

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Barrister AI")

secret_key = os.getenv('FLASK_SECRET_KEY', secrets.token_hex(16))
app.add_middleware(SessionMiddleware, secret_key=secret_key)

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# State is completely distributed via Supabase


@app.get('/', response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post('/upload')
async def upload_file(request: Request, file: UploadFile = File(...)):
    """Upload and process a legal PDF document."""
    try:
        if not file:
            raise HTTPException(status_code=400, detail="No file provided")

        if not file.filename:
            raise HTTPException(status_code=400, detail="No file selected")

        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Invalid file type. Please upload a PDF document.")

        # Determine session_id early so we can check the lock before doing any work
        session_id = request.session.get('session_id', secrets.token_hex(8))

        if not supabase:
            raise HTTPException(status_code=500, detail="Supabase is not configured. Cannot process uploads.")

        # Check distributed lock in Supabase
        response = supabase.table('document_sessions').select('status').eq('session_id', session_id).execute()
        if response.data and response.data[0].get('status') == 'processing':
            raise HTTPException(status_code=429, detail="Please wait — a document is already being processed.")

        # Acquire lock
        supabase.table('document_sessions').upsert({
            'session_id': session_id,
            'filename': file.filename,
            'filepath': os.path.join(UPLOAD_FOLDER, file.filename),
            'status': 'processing'
        }).execute()

        filename = file.filename
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        
        with open(filepath, "wb") as buffer:
            buffer.write(await file.read())

        logger.info(f"📄 Processing uploaded file: {filename}")

        try:
            # Import here to avoid circular imports and slow startup
            from modules.legal_analyzer import process_pdf

            # Process the PDF
            result = process_pdf(filepath)

            if not result['success']:
                raise HTTPException(status_code=500, detail=result['error'])

            # Store session ID
            request.session['session_id'] = session_id
            request.session['current_pdf'] = filepath
            request.session['current_filename'] = filename

            # Upsert session data to Supabase with completed status
            supabase.table('document_sessions').upsert({
                'session_id': session_id,
                'filename': filename,
                'filepath': filepath,
                'doc_info': result['doc_info'],
                'pages_data': result['pages_data'],
                'chunks': result['chunks'],
                'status': 'completed'
            }).execute()
            logger.info(f"✅ Session {session_id} saved to Supabase")

            doc_info = result['doc_info']
            detected_types = doc_info.get('detected_types', [])

            return {
                'success': True,
                'message': f'Legal document processed successfully',
                'filename': filename,
                'doc_info': {
                    'total_pages': doc_info['total_pages'],
                    'total_sections': doc_info['total_sections'],
                    'detected_types': detected_types,
                    'total_characters': doc_info['total_characters']
                }
            }

    except Exception as e:
        if supabase:
            # Delete lock on failure so user isn't stuck
            supabase.table('document_sessions').delete().eq('session_id', session_id).execute()
        if isinstance(e, HTTPException):
            raise
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Server error: {str(e)}')


def _get_document_data(request: Request):
    """Get the processed document data for the current session."""
    session_id = request.session.get('session_id')
    if not session_id:
        return None

    doc_data = None
    if supabase:
        try:
            response = supabase.table('document_sessions').select('*').eq('session_id', session_id).execute()
            if response.data and len(response.data) > 0:
                doc_data = response.data[0]
        except Exception as e:
            logger.error(f"❌ Failed to fetch session from Supabase: {e}")
            
    if not doc_data:
        return None

    # Reconstruct vector_store from cached .pkl file
    if 'vector_store' not in doc_data:
        filepath = doc_data.get('filepath')
        cache_path = f"{os.path.basename(filepath)}.pkl"
        try:
            with open(cache_path, "rb") as f:
                doc_data['vector_store'] = pickle.load(f)
        except Exception as e:
            logger.error(f"❌ Failed to load vector store from cache: {e}")
            return None

    return doc_data


@app.post('/analyze')
async def analyze(request: Request):
    """Perform full legal analysis on the uploaded document."""
    try:
        doc_data = _get_document_data(request)
        if not doc_data:
            raise HTTPException(status_code=400, detail="Please upload a document first.")

        from modules.legal_analyzer import full_analysis

        result = full_analysis(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return {
            'success': True,
            'analysis': result['analysis'],
            'sources': result['sources']
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Analysis failed: {str(e)}')


class AskRequest(BaseModel):
    question: str


@app.post('/ask')
async def ask_question_route(request: Request, payload: AskRequest):
    """Answer a specific legal question about the document."""
    try:
        question = payload.question.strip()

        if not question:
            raise HTTPException(status_code=400, detail="No question provided")

        doc_data = _get_document_data(request)
        if not doc_data:
            raise HTTPException(status_code=400, detail="Please upload a document first.")

        from modules.legal_analyzer import ask_question

        result = ask_question(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info'],
            question
        )

        return {
            'success': True,
            'answer': result['answer'],
            'sources': result['sources']
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Error: {str(e)}')


@app.post('/summary')
async def summary(request: Request):
    """Generate a structured summary of the document."""
    try:
        doc_data = _get_document_data(request)
        if not doc_data:
            raise HTTPException(status_code=400, detail="Please upload a document first.")

        from modules.legal_analyzer import get_summary

        result = get_summary(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return {
            'success': True,
            'summary': result['summary'],
            'sources': result['sources']
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Summary failed: {str(e)}')


@app.post('/risks')
async def risks(request: Request):
    """Perform risk analysis on the document."""
    try:
        doc_data = _get_document_data(request)
        if not doc_data:
            raise HTTPException(status_code=400, detail="Please upload a document first.")

        from modules.legal_analyzer import get_risk_analysis

        result = get_risk_analysis(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return {
            'success': True,
            'risk_analysis': result['risk_analysis'],
            'sources': result['sources']
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Risk analysis failed: {str(e)}')


@app.post('/keypoints')
async def keypoints(request: Request):
    """Extract key points from the document."""
    try:
        doc_data = _get_document_data(request)
        if not doc_data:
            raise HTTPException(status_code=400, detail="Please upload a document first.")

        from modules.legal_analyzer import get_key_points

        result = get_key_points(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return {
            'success': True,
            'key_points': result['key_points'],
            'sources': result['sources']
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Key points extraction failed: {str(e)}')


if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'
    logger.info(f"⚖️ Barrister AI starting on port {port} with FastAPI...")
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=debug)
