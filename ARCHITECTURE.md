# ARCHITECTURE.md — Barrister AI

## Overview

Barrister AI is a monolithic Flask web application. All logic lives in a single Python process. There is no queue, no worker process, no database, and no separate service layer.

```
Browser
  │
  │  HTTP (GET / POST)
  ▼
Flask App (app.py)
  │
  ├── /upload  ──►  modules/legal_analyzer.py → process_pdf()
  │                     │
  │                     ├── modules/pdf_loader.py       (PDF → pages_data)
  │                     ├── modules/chunking.py         (pages_data → chunks)
  │                     └── modules/vector_store.py     (chunks → FAISS index)
  │
  ├── /analyze ──►  modules/legal_analyzer.py → full_analysis()
  ├── /summary ──►  modules/legal_analyzer.py → get_summary()
  ├── /risks   ──►  modules/legal_analyzer.py → get_risk_analysis()
  ├── /keypoints ► modules/legal_analyzer.py → get_key_points()
  └── /ask     ──►  modules/legal_analyzer.py → ask_question()
                        │
                        ├── modules/retriever.py        (query enhancement, reranking, context building)
                        ├── modules/vector_store.py     (FAISS similarity search)
                        └── modules/prompt_engine.py    (prompt templates)
                                │
                                └── OpenRouter API (external LLM)
```

---

## Directory Structure

```
/
├── app.py                     # Flask application, all route handlers
├── requirements.txt           # Python dependencies
├── .env                       # Environment variables (API key, port, debug flag)
├── _test_workflow.py          # Manual integration test script
├── modules/
│   ├── __init__.py            # Empty package marker
│   ├── legal_analyzer.py      # Orchestrator: coordinates all pipeline stages
│   ├── pdf_loader.py          # PDF text extraction and section detection
│   ├── chunking.py            # Text splitting with page/section metadata
│   ├── embedding.py           # Embedding model singleton (all-MiniLM-L6-v2)
│   ├── vector_store.py        # FAISS index creation, search, pickle caching
│   ├── retriever.py           # Query enhancement, reranking, context assembly
│   └── prompt_engine.py       # All LLM prompt templates
├── templates/
│   └── index.html             # Single-page application HTML
├── static/
│   ├── css/style.css          # All UI styling
│   └── js/script.js           # All frontend JavaScript
├── uploads/                   # Uploaded PDF files (created at runtime)
├── *.pkl                      # FAISS vector store cache files (per PDF)
└── server_8080.log            # Server log (manually redirected)
```

---

## Components

### app.py — Flask Application
- Initialises the Flask app
- Sets `secret_key` from env or generates a random one with `secrets.token_hex(16)`
- Holds `document_store` — a module-level Python `dict` that maps `session_id` to processed document data
- Stores `session_id`, `current_pdf`, `current_filename` in Flask's signed cookie session
- Handles Windows-specific PyTorch DLL path patching on startup

### modules/legal_analyzer.py — Pipeline Orchestrator
- Defines `FREE_MODELS` list (3 models in fallback order):
  1. `google/gemma-3-12b-it:free`
  2. `mistralai/mistral-small-3.1-24b-instruct:free`
  3. `meta-llama/llama-3.2-3b-instruct:free`
- `_invoke_llm_with_fallback()`: iterates through `FREE_MODELS`, tries each, sleeps 2 seconds between failures
- LLM is configured with `temperature=0.3`, `max_tokens=2000`, `request_timeout=35`, `max_retries=1`
- LLM calls go to `https://openrouter.ai/api/v1` using the `langchain_openai.ChatOpenAI` client with a custom base URL

### modules/pdf_loader.py — PDF Extraction
- Uses `PyPDF2.PdfReader` to extract text page by page
- Contains `fix_doubled_text()`: heuristic to fix doubled-character encoding artifacts in some PDFs
- Contains `detect_section_header()`: regex-based detection of 11 legal section header patterns plus all-caps line detection
- Returns `pages_data`: a list of dicts, one per page, with `page`, `text`, `sections`
- `get_document_info()`: scans all text for document type keywords (12 types), returns top 3 matches

### modules/chunking.py — Text Splitting
- Uses `langchain_text_splitters.RecursiveCharacterTextSplitter` with `chunk_size=800`, `chunk_overlap=200`
- Separators in order: `\n\n`, `\n`, `. `, `; `, `, `, ` `, `""`
- Each chunk carries metadata: `text`, `page`, `pages`, `section`, `chunk_id`
- `_merge_boundary_chunks()`: expands `pages` list for chunks at page transitions to include adjacent page numbers

### modules/embedding.py — Embedding Model
- Singleton pattern using a module-level global `_embedding_model`
- Model: `sentence-transformers/all-MiniLM-L6-v2` from HuggingFace
- Runs on CPU (`device="cpu"`)
- `normalize_embeddings=True`, `batch_size=32`
- Downloaded from HuggingFace Hub at first use (requires internet)

### modules/vector_store.py — FAISS Index
- Creates a `langchain_community.vectorstores.faiss.FAISS` index from chunk documents
- Each document stored with metadata: `chunk_id`, `page`, `pages`, `section`
- Caches the index to a `.pkl` file (pickle) named after the PDF filename
- On upload, any existing cache file for that filename is deleted and rebuilt
- Search: `similarity_search_with_score()` with optional keyword boosting (BM25-like overlap scoring)

### modules/retriever.py — Retrieval & Reranking
- `enhance_legal_query()`: expands abbreviations (NDA, IP, ToS, contractions) using regex substitution
- `rerank_legal_contexts()`: re-scores FAISS results by combining FAISS distance, query term frequency, and legal keyword presence (18 boost words defined)
- `build_legal_context()`: assembles the final context string with `[Source N | Page X | Section: Y]` headers; deduplicates by `chunk_id`
- `expand_page_context()`: adds chunks from pages N-1 and N+1 relative to primary results; caps total at 10 documents

### modules/prompt_engine.py — Prompts
- Contains 5 prompt templates as module-level string constants:
  - `FULL_ANALYSIS_PROMPT`
  - `QUESTION_ANSWER_PROMPT`
  - `SUMMARY_PROMPT`
  - `RISK_ANALYSIS_PROMPT`
  - `KEY_POINTS_PROMPT`
- Also defines `BARRISTER_SYSTEM_PROMPT` (not currently used as a system message in any chain — all prompts are sent as single user messages)
- `get_prompt(analysis_type)` returns the matching template string

### templates/index.html — Frontend
- Single HTML file
- Loads Font Awesome 6.4.0 from cdnjs (external CDN)
- Loads Inter and Playfair Display fonts from Google Fonts (external CDN)
- Two main view states: upload section (before document) and intelligence area (after document)

### static/js/script.js — Frontend Logic
- Vanilla JavaScript, no framework
- Uses `fetch()` with `AbortController` for cancellable requests
- `formatMarkdown()`: minimal regex-based Markdown-to-HTML converter (headings, bold, list items)
- Analysis results are rendered as "report cards" injected into the DOM
- Stop button aborts the current fetch request

---

## Session Management

Flask's built-in signed cookie session stores:
- `session_id` — a random hex token generated with `secrets.token_hex(8)`
- `current_pdf` — filepath of the uploaded PDF
- `current_filename` — original filename

The `document_store` dict in `app.py` maps `session_id` to:
- `filepath` — path to the uploaded PDF on disk
- `filename` — sanitised filename
- `pages_data` — raw page extraction output
- `chunks` — all chunks with metadata
- `vector_store` — the FAISS index object
- `doc_info` — document metadata

**This entire store is in-process memory. It is lost on every server restart.**

---

## External Dependencies

| Dependency | Purpose | Where Called |
|---|---|---|
| OpenRouter API (`openrouter.ai/api/v1`) | LLM inference | `modules/legal_analyzer.py` |
| HuggingFace Hub | Download `all-MiniLM-L6-v2` model weights | `modules/embedding.py` (on first use) |
| cdnjs.cloudflare.com | Font Awesome icons | `templates/index.html` |
| fonts.googleapis.com | Inter + Playfair Display fonts | `static/css/style.css` |

---

## Runtime Startup Sequence

1. `app.py` runs Windows DLL path fix for PyTorch (Windows only)
2. `.env` is loaded with `python-dotenv`
3. Flask app is initialised with secret key and upload folder
4. `uploads/` directory is created if it doesn't exist
5. Flask development server starts on port from `FLASK_PORT` env var (default: 5000; set to 8080 in `.env`)
6. On first PDF upload: embedding model is downloaded from HuggingFace and loaded into memory (slow — ~8 seconds observed in logs)
7. Subsequent uploads reuse the cached embedding model singleton
