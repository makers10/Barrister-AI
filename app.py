# app.py
"""
Barrister AI — Flask Application
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

from flask import Flask, render_template, request, jsonify, session
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', secrets.token_hex(16))
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024  # 200MB max

# Create uploads folder
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# In-memory store for processed documents (per session)
document_store = {}


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_file():
    """Upload and process a legal PDF document."""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Invalid file type. Please upload a PDF document.'}), 400

        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        logger.info(f"📄 Processing uploaded file: {filename}")

        # Import here to avoid circular imports and slow startup
        from modules.legal_analyzer import process_pdf

        # Process the PDF
        result = process_pdf(filepath)

        if not result['success']:
            return jsonify({'error': result['error']}), 500

        # Store in memory with session ID
        session_id = session.get('session_id', secrets.token_hex(8))
        session['session_id'] = session_id
        session['current_pdf'] = filepath
        session['current_filename'] = filename

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

        return jsonify({
            'success': True,
            'message': f'Legal document processed successfully',
            'filename': filename,
            'doc_info': {
                'total_pages': doc_info['total_pages'],
                'total_sections': doc_info['total_sections'],
                'detected_types': detected_types,
                'total_characters': doc_info['total_characters']
            }
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500


def _get_document_data():
    """Get the processed document data for the current session."""
    session_id = session.get('session_id')
    if not session_id or session_id not in document_store:
        return None
    return document_store[session_id]


@app.route('/analyze', methods=['POST'])
def analyze():
    """Perform full legal analysis on the uploaded document."""
    try:
        doc_data = _get_document_data()
        if not doc_data:
            return jsonify({'error': 'Please upload a document first.'}), 400

        from modules.legal_analyzer import full_analysis

        result = full_analysis(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return jsonify({
            'success': True,
            'analysis': result['analysis'],
            'sources': result['sources']
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Analysis failed: {str(e)}'}), 500


@app.route('/ask', methods=['POST'])
def ask_question_route():
    """Answer a specific legal question about the document."""
    try:
        data = request.get_json()
        question = data.get('question', '').strip()

        if not question:
            return jsonify({'error': 'No question provided'}), 400

        doc_data = _get_document_data()
        if not doc_data:
            return jsonify({'error': 'Please upload a document first.'}), 400

        from modules.legal_analyzer import ask_question

        result = ask_question(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info'],
            question
        )

        return jsonify({
            'success': True,
            'answer': result['answer'],
            'sources': result['sources']
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Error: {str(e)}'}), 500


@app.route('/summary', methods=['POST'])
def summary():
    """Generate a structured summary of the document."""
    try:
        doc_data = _get_document_data()
        if not doc_data:
            return jsonify({'error': 'Please upload a document first.'}), 400

        from modules.legal_analyzer import get_summary

        result = get_summary(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return jsonify({
            'success': True,
            'summary': result['summary'],
            'sources': result['sources']
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Summary failed: {str(e)}'}), 500


@app.route('/risks', methods=['POST'])
def risks():
    """Perform risk analysis on the document."""
    try:
        doc_data = _get_document_data()
        if not doc_data:
            return jsonify({'error': 'Please upload a document first.'}), 400

        from modules.legal_analyzer import get_risk_analysis

        result = get_risk_analysis(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return jsonify({
            'success': True,
            'risk_analysis': result['risk_analysis'],
            'sources': result['sources']
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Risk analysis failed: {str(e)}'}), 500


@app.route('/keypoints', methods=['POST'])
def keypoints():
    """Extract key points from the document."""
    try:
        doc_data = _get_document_data()
        if not doc_data:
            return jsonify({'error': 'Please upload a document first.'}), 400

        from modules.legal_analyzer import get_key_points

        result = get_key_points(
            doc_data['vector_store'],
            doc_data['chunks'],
            doc_data['doc_info']
        )

        return jsonify({
            'success': True,
            'key_points': result['key_points'],
            'sources': result['sources']
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'Key points extraction failed: {str(e)}'}), 500


if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'
    logger.info(f"⚖️ Barrister AI starting on port {port}...")
    app.run(debug=debug, port=port, use_reloader=False)
