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

from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import uvicorn

load_dotenv()

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

# In-memory store for processed documents (per session)
document_store = {}

# Per-session processing lock: set of session_ids currently being processed
processing_sessions = set()


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

        # Reject if this session already has an upload/analysis in flight
        if session_id in processing_sessions:
            raise HTTPException(status_code=429, detail="Please wait — a document is already being processed.")

        # Acquire the processing lock for this session
        processing_sessions.add(session_id)

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

            # Store in memory with session ID
            request.session['session_id'] = session_id
            request.session['current_pdf'] = filepath
            request.session['current_filename'] = filename

            document_store[session_id] = {
                'filepath': filepath,
                'filename': filename,
                'pages_data': result['pages_data'],
                'chunks': result['chunks'],
                'vector_store': result['vector_store'],
                'doc_info': result['doc_info']
            }

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

        finally:
            # Always release the lock when upload+processing is done
            processing_sessions.discard(session_id)

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Server error: {str(e)}')


def _get_document_data(request: Request):
    """Get the processed document data for the current session."""
    session_id = request.session.get('session_id')
    if not session_id or session_id not in document_store:
        return None
    return document_store[session_id]


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
