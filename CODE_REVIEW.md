# CODE_REVIEW.md
## Barrister AI — Factual Engineering Code Review
### Date: 2026-07-04
### Scope: Full source code review of all Python modules, HTML template, JavaScript, CSS, and requirements.

---

# Overview

Barrister AI is a single-process Flask web application that accepts a user-uploaded PDF document,
processes it through a RAG (Retrieval-Augmented Generation) pipeline, and returns AI-generated
legal analysis. The application is written in Python (backend) and vanilla JavaScript (frontend).

The stack consists of:
- **Flask** — HTTP server and routing
- **PyPDF2** — PDF text extraction
- **LangChain** — prompt templating, text splitting, document abstraction, FAISS wrapper
- **FAISS (faiss-cpu)** — in-process vector similarity search
- **sentence-transformers / all-MiniLM-L6-v2** — local embedding model running on CPU
- **OpenRouter API** — external LLM inference endpoint (accessed via LangChain's ChatOpenAI)
- **Vanilla JavaScript** — all frontend logic, no framework

The application runs as a single Python process. All session state is held in a module-level
Python dictionary called `document_store` in `app.py`. No database exists. No authentication
exists. No queue exists. All processing is synchronous within the HTTP request thread.

The application has two frontend states:
1. Upload screen — shown before a document is loaded
2. Intelligence workspace — shown after successful upload, with chat and analysis panels

---

# Backend Review

## Flask Initialization (`app.py`)

`app.py` is the entry point. On module load, before any Flask code runs, the following
executes at the top level:

**Windows DLL path fix (lines 13–22):**
```
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
```
This calls `os.add_dll_directory()` for any PyTorch lib path that exists on disk.
Exceptions from `os.add_dll_directory()` are silently swallowed. On non-Windows platforms,
the block does not execute.

**After imports, `load_dotenv()` is called.** This reads `.env` from the working directory.
The `.env` file sets `OPENROUTER_API_KEY`, `FLASK_SECRET_KEY`, `FLASK_DEBUG`, `FLASK_PORT`.

**Logging is configured:**
```
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
```
This configures the root logger at INFO level, writing to stdout.

**Flask app configuration:**
- `app.secret_key` = `os.getenv('FLASK_SECRET_KEY', secrets.token_hex(16))`
  If `FLASK_SECRET_KEY` is not set, a random 16-byte hex key is generated per startup.
- `app.config['UPLOAD_FOLDER']` = `'uploads'` (relative to working directory)
- `app.config['MAX_CONTENT_LENGTH']` = `200 * 1024 * 1024` (200MB)
- `os.makedirs('uploads', exist_ok=True)` is called at module load.

**Global state:**
```python
document_store = {}
```
Module-level Python dict. Holds all processed document data, keyed by `session_id`.
No size limit. No TTL. No eviction. Grows for the lifetime of the process.

**Server startup (when run as `__main__`):**
```python
port = int(os.getenv('FLASK_PORT', 5000))
debug = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'
app.run(debug=debug, port=port, use_reloader=False)
```
`use_reloader=False` disables the Werkzeug auto-reloader. No `host=` parameter is passed,
so Flask binds to `127.0.0.1` by default. No `threaded=` or `processes=` argument is passed.

---

## Route: `GET /`

```python
@app.route('/')
def index():
    return render_template('index.html')
```
Renders `templates/index.html` using Jinja2. No session check. No authentication.
Returns 200 with HTML content.

---

## Route: `POST /upload`

**Purpose:** Accept a PDF file, process it through the full ingestion pipeline, store results
in `document_store`, and return document metadata.

**Request:** `multipart/form-data` with field name `file`.

**Validation (in order):**
1. `'file' not in request.files` → returns `{'error': 'No file provided'}`, 400
2. `file.filename == ''` → returns `{'error': 'No file selected'}`, 400
3. `not file.filename.lower().endswith('.pdf')` → returns `{'error': 'Invalid file type...'}`, 400

No MIME type check. Extension check only.

**Processing:**
1. `secure_filename(file.filename)` produces a safe filename.
2. File is saved to `uploads/<filename>` via `file.save(filepath)`.
3. `from modules.legal_analyzer import process_pdf` is executed inside the handler (deferred import).
4. `process_pdf(filepath)` is called. This is synchronous and blocks the thread.
5. If `result['success']` is False, returns `{'error': result['error']}`, 500.
6. `session_id` is retrieved from `session.get('session_id', secrets.token_hex(8))`.
   If no session_id exists, a new 8-byte hex token is generated.
7. `session['session_id']`, `session['current_pdf']`, `session['current_filename']` are set.
8. `document_store[session_id]` is assigned a dict with keys:
   `filepath`, `filename`, `pages_data`, `chunks`, `vector_store`, `doc_info`.
9. Returns JSON: `success`, `message`, `filename`, and a `doc_info` sub-object containing
   `total_pages`, `total_sections`, `detected_types`, `total_characters`.

**Error handling:** A single broad `except Exception as e` wraps the entire function body.
On any unhandled exception: `traceback.print_exc()` is called (writes to stderr),
then returns `{'error': f'Server error: {str(e)}'}`, 500.

---

## Helper: `_get_document_data()`

```python
def _get_document_data():
    session_id = session.get('session_id')
    if not session_id or session_id not in document_store:
        return None
    return document_store[session_id]
```
Not a route. Called by all 5 analysis routes. Reads `session_id` from the Flask session cookie
and looks it up in `document_store`. Returns the dict or `None`.

---

## Route: `POST /analyze`

Calls `_get_document_data()`. If None, returns `{'error': 'Please upload a document first.'}`, 400.
Deferred import: `from modules.legal_analyzer import full_analysis`.
Calls `full_analysis(doc_data['vector_store'], doc_data['chunks'], doc_data['doc_info'])`.
Returns `{'success': True, 'analysis': result['analysis'], 'sources': result['sources']}`.
The `result['doc_info']` key returned by `full_analysis()` is not included in the response.
Error handling: same broad `except Exception` pattern with `traceback.print_exc()`.
Error response: `{'error': f'Analysis failed: {str(e)}'}`, 500.

---

## Route: `POST /ask`

Calls `request.get_json()` to parse the request body.
Reads `question = data.get('question', '').strip()`.
If empty after strip: returns `{'error': 'No question provided'}`, 400.
Calls `_get_document_data()`. If None, returns 400.
Deferred import: `from modules.legal_analyzer import ask_question`.
Calls `ask_question(vector_store, chunks, doc_info, question)`.
Returns `{'success': True, 'answer': result['answer'], 'sources': result['sources']}`.
Error response: `{'error': f'Error: {str(e)}'}`, 500.

---

## Route: `POST /summary`

Calls `_get_document_data()`. If None, returns 400.
Deferred import: `from modules.legal_analyzer import get_summary`.
Calls `get_summary(vector_store, chunks, doc_info)`.
Returns `{'success': True, 'summary': result['summary'], 'sources': result['sources']}`.
Error response: `{'error': f'Summary failed: {str(e)}'}`, 500.

---

## Route: `POST /risks`

Calls `_get_document_data()`. If None, returns 400.
Deferred import: `from modules.legal_analyzer import get_risk_analysis`.
Returns `{'success': True, 'risk_analysis': result['risk_analysis'], 'sources': result['sources']}`.
Error response: `{'error': f'Risk analysis failed: {str(e)}'}`, 500.

---

## Route: `POST /keypoints`

Calls `_get_document_data()`. If None, returns 400.
Deferred import: `from modules.legal_analyzer import get_key_points`.
Returns `{'success': True, 'key_points': result['key_points'], 'sources': result['sources']}`.
Error response: `{'error': f'Key points extraction failed: {str(e)}'}`, 500.

---

## Session Handling

Flask's default signed cookie session is used. The session cookie is signed with `app.secret_key`
but not encrypted. Its contents are base64-encoded and readable by the client.

Three values are stored in the session:
- `session_id` — 8-byte hex string linking to `document_store`
- `current_pdf` — server-side filesystem path of the uploaded PDF
- `current_filename` — the sanitised filename

No session expiry is configured. No `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_HTTPONLY`,
or `SESSION_COOKIE_SAMESITE` is explicitly set (Flask defaults apply).

---

## document_store Object Lifecycle

Created at module load as an empty dict.
Populated on each successful `/upload` call.
Keys: string `session_id` values.
Values: dicts containing `filepath` (str), `filename` (str), `pages_data` (List[Dict]),
`chunks` (List[Dict]), `vector_store` (FAISS object), `doc_info` (Dict).
Never deleted during normal operation.
Lost entirely when the Python process restarts.
A new upload by the same session overwrites the existing entry for that `session_id`.

---
---

# Module Review

---

## `modules/legal_analyzer.py`

**Purpose:** Orchestrates the full document processing and analysis pipeline. Coordinates all
other modules. Provides the five analysis functions called by the Flask routes. Handles LLM
invocation with a multi-model fallback chain.

**Module-level imports:** `os`, `time`, `logging`, `Dict`, `Optional`, `List`, `load_dotenv`,
`ChatOpenAI`, `ChatPromptTemplate`, plus all functions from pdf_loader, chunking, vector_store,
retriever, and prompt_engine.

**Module-level globals:**
- `logger = logging.getLogger(__name__)` — module logger
- `FREE_MODELS` — a list of 3 model name strings:
  `["google/gemma-3-12b-it:free", "mistralai/mistral-small-3.1-24b-instruct:free", "meta-llama/llama-3.2-3b-instruct:free"]`
- `BARRISTER_SYSTEM_PROMPT` is imported but never used in any function in this module.
- `load_dotenv()` is called at module load time.

---

### `_get_llm(model_name: str = None) -> ChatOpenAI`

Creates and returns a new `ChatOpenAI` instance. Called inside `_invoke_llm_with_fallback()`
on every model attempt.

Parameters:
- `model_name` — if None, defaults to `FREE_MODELS[0]`

Configuration applied:
- `openai_api_base`: `"https://openrouter.ai/api/v1"`
- `openai_api_key`: `os.getenv("OPENROUTER_API_KEY")` — read from environment on each call
- `model_name`: as provided
- `default_headers`: `{"HTTP-Referer": "http://localhost:5000", "X-Title": "Barrister AI"}`
- `temperature`: `0.3`
- `max_tokens`: `2000`
- `request_timeout`: `35`
- `max_retries`: `1`

A new instance is created on every call. No LLM instance is cached.

---

### `_invoke_llm_with_fallback(prompt_template: ChatPromptTemplate, variables: Dict) -> str`

Iterates through `FREE_MODELS` in order. For each model:
1. Logs `"🤖 Trying model: {model_name}..."` at INFO.
2. Calls `_get_llm(model_name)` to create a new `ChatOpenAI` instance.
3. Builds a LangChain chain: `prompt_template | llm`.
4. Calls `chain.invoke(variables)` synchronously. This blocks the thread.
5. Calls `.content.strip()` on the response.
6. If `answer` is truthy and `len(answer) > 20`, logs `"✅ Success with {model_name}"` and returns the answer.
7. On any `Exception`: logs `"⚠️ {model_name} failed: {type(e).__name__}: {e}"` at WARNING,
   calls `time.sleep(2)`, then `continue`s to next model.

After all 3 models are exhausted without a valid answer:
- Logs `"❌ All LLM models failed"` at ERROR.
- Returns the literal string:
  `"⚠️ Unable to generate analysis at this time. All AI models are currently unavailable. Please try again in a few minutes."`

Note: `time.sleep(2)` executes inside the `except` block before `continue`. This means:
- After model 1 failure: 2 seconds sleep
- After model 2 failure: 2 seconds sleep
- After model 3 failure: `continue` runs, loop ends, no more iterations — but the `time.sleep(2)`
  already executed before `continue` for model 3 as well.

---

### `process_pdf(pdf_path: str) -> Dict`

Called by the `/upload` route handler.

Steps in order:
1. `load_pdf_with_pages(pdf_path)` — if returns empty list, returns `{'success': False, 'error': '...scanned image...'}`.
2. `get_document_info(pages_data)` — produces `doc_info` dict.
3. `chunk_with_page_index(pages_data)` — if returns empty list, returns `{'success': False, 'error': '...readable text...'}`.
4. `cache_path = f"{os.path.basename(pdf_path)}.pkl"` — e.g., `"sample.pdf.pkl"` in the working directory.
5. If `cache_path` exists on disk: `os.remove(cache_path)` is called. Exceptions silently ignored.
6. `create_vector_store(chunks, cache_path=cache_path)` — if returns None, returns `{'success': False, 'error': 'Failed to create search index.'}`.
7. Returns `{'success': True, 'pages_data': ..., 'chunks': ..., 'vector_store': ..., 'doc_info': ..., 'error': None}`.

Outer `try/except Exception`: logs `"❌ PDF processing failed: {e}"` at ERROR and returns
`{'success': False, 'error': f'Error processing PDF: {str(e)}'}`.

---

### `full_analysis(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict`

1. `search_vector_store(vector_store, "legal terms obligations rights", top_k=10)` — returns List[Tuple[Document, float]].
2. `rerank_legal_contexts("legal terms obligations rights conditions", all_results)` — note: different query string from step 1.
3. `expand_page_context(docs, chunks)`.
4. `build_legal_context(docs, chunks)` — returns `(context, sources)`.
5. Builds `sections_summary`: iterates all chunks, collects unique `chunk['section']` values (preserving order), joins first 20 with `", "`. If none: `"No specific sections detected"`.
6. Builds `doc_type`: joins `doc_info.get('detected_types', ['Unknown'])` with `", "`. If empty string after join: `'Unknown'`.
7. `ChatPromptTemplate.from_messages([("user", get_prompt('full_analysis'))])` — created fresh on each call.
8. `_invoke_llm_with_fallback(prompt_template, {'context': context, 'total_pages': ..., 'doc_type': ..., 'sections_summary': ...})`.
9. Returns `{'analysis': answer, 'sources': sources, 'doc_info': doc_info}`.

---

### `ask_question(vector_store, chunks: List[Dict], doc_info: Dict, question: str) -> Dict`

1. `enhance_legal_query(question)` — expands abbreviations.
2. `search_vector_store(vector_store, enhanced_query, top_k=6)`.
3. `rerank_legal_contexts(enhanced_query, results)`.
4. `expand_page_context(docs, chunks)`.
5. `build_legal_context(docs, chunks)`.
6. `ChatPromptTemplate.from_messages([("user", get_prompt('question'))])` — created fresh on each call.
7. `_invoke_llm_with_fallback(prompt_template, {'context': context, 'question': question})`.
   Note: `question` is the original question, not `enhanced_query`.
8. Returns `{'answer': answer, 'sources': sources}`.

---

### `get_summary(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict`

1. `search_vector_store(vector_store, "summary overview purpose scope", top_k=8)`.
2. `rerank_legal_contexts("summary overview purpose", results)` — different query from step 1.
3. `expand_page_context(docs, chunks)`.
4. `build_legal_context(docs, chunks)`.
5. Builds `doc_type` same as `full_analysis`.
6. `ChatPromptTemplate.from_messages([("user", get_prompt('summary'))])` — fresh per call.
7. `_invoke_llm_with_fallback(prompt_template, {'context': context, 'total_pages': ..., 'doc_type': ...})`.
8. Returns `{'summary': answer, 'sources': sources}`.

---

### `get_risk_analysis(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict`

1. `search_vector_store(vector_store, "liability risk penalty termination breach indemnify limitation", top_k=8)`.
2. `rerank_legal_contexts("risk liability termination breach penalty", results)` — different query.
3. `expand_page_context(docs, chunks)`.
4. `build_legal_context(docs, chunks)`.
5. `ChatPromptTemplate.from_messages([("user", get_prompt('risk_analysis'))])` — fresh per call.
6. `_invoke_llm_with_fallback(prompt_template, {'context': context})`.
7. Returns `{'risk_analysis': answer, 'sources': sources}`.

---

### `get_key_points(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict`

1. `search_vector_store(vector_store, "obligations rights payment deadline penalty condition", top_k=8)`.
2. `rerank_legal_contexts("obligations rights terms conditions", results)` — different query.
3. `expand_page_context(docs, chunks)`.
4. `build_legal_context(docs, chunks)`.
5. `ChatPromptTemplate.from_messages([("user", get_prompt('key_points'))])` — fresh per call.
6. `_invoke_llm_with_fallback(prompt_template, {'context': context})`.
7. Returns `{'key_points': answer, 'sources': sources}`.

---

## `modules/pdf_loader.py`

**Purpose:** Extracts text from PDF files page by page using PyPDF2. Detects section headers.
Produces document metadata including detected document type.

**Module-level globals:** `logger = logging.getLogger(__name__)`

---

### `fix_doubled_text(text: str) -> str`

Called once per PDF page from `load_pdf_with_pages()`.

Logic:
1. If `text` is falsy, returns `text` unchanged.
2. Takes `text[:500]`, removes spaces and newlines → `sample`.
3. If `len(sample) < 10`, returns `text` unchanged.
4. Iterates `sample` in steps of 2 (`for i in range(0, len(sample) - 1, 2)`).
   For each pair: increments `total_pairs`. If `sample[i] == sample[i+1]`, increments `double_count`.
5. If `total_pairs > 0` and `double_count / total_pairs > 0.6`:
   - Logs `"🔧 Detected doubled characters, fixing..."` at INFO.
   - Builds `fixed` string by iterating character by character:
     - Appends `text[i]` to `fixed`.
     - If `text[i] == text[i+1]` AND `text[i]` not in `' \n\r\t'`, skips ahead by 2 (`i += 2`).
     - Otherwise advances by 1 (`i += 1`).
   - Returns `fixed`.
6. Otherwise returns original `text`.

---

### `detect_section_header(line: str) -> Optional[str]`

Called once per line of each page's text from `load_pdf_with_pages()`.

1. Strips whitespace from `line`.
2. If empty or `len(line) < 3`, returns None.
3. Tests 11 regex patterns via `re.match()`:
   - `r'^(ARTICLE|Article)\s+\d+[\.:;\-\s]'`
   - `r'^(SECTION|Section)\s+\d+[\.\d]*[\.:;\-\s]'`
   - `r'^(CLAUSE|Clause)\s+\d+[\.\d]*[\.:;\-\s]'`
   - `r'^(SCHEDULE|Schedule)\s+[A-Z\d]+'`
   - `r'^(APPENDIX|Appendix)\s+[A-Z\d]+'`
   - `r'^(PART|Part)\s+[IVXLCDM\d]+'`
   - `r'^(EXHIBIT|Exhibit)\s+[A-Z\d]+'`
   - `r'^(RECITAL|Recital)[S]?\s*'`
   - `r'^(WHEREAS|WITNESSETH|NOW\s*,?\s*THEREFORE)'`
   - `r'^\d+\.\s+[A-Z][A-Z\s]{3,}'`
   - `r'^\d+\.\d+\s+[A-Z]'`
   If any matches: returns `line`.
4. If `line.isupper()` AND `len(line) > 5` AND `len(line) < 100`: returns `line`.
5. Otherwise returns None.

---

### `load_pdf_with_pages(file_path: str) -> List[Dict]`

1. Logs `"📄 Loading PDF: {file_path}"` at INFO.
2. `PdfReader(file_path)` opens the PDF.
3. Logs `"📖 PDF has {total_pages} pages"` at INFO.
4. For each page (1-indexed via `enumerate(reader.pages, 1)`):
   - `page.extract_text() or ""` — returns empty string if extraction fails.
   - `fix_doubled_text(page_text)` is applied.
   - Splits text by `'\n'`, calls `detect_section_header()` on each line, collects non-None results.
   - Appends `{'page': page_num, 'text': page_text, 'sections': sections}` to `pages_data`.
5. Logs `"📝 Extracted {total_chars} chars, {total_sections} sections from {total_pages} pages"` at INFO.
6. Returns `pages_data`.

Outer `try/except Exception`: logs `"❌ Error reading PDF: {e}"` at ERROR and returns `[]`.

---

### `get_document_info(pages_data: List[Dict]) -> Dict`

1. Concatenates all page text with space separator, lowercases → `all_text`.
2. Collects all sections from all pages as `[{'section': str, 'page': int}, ...]`.
3. Defines `type_keywords` dict with 12 document type keys, each with a list of keywords.
4. For each type: counts how many keywords appear in `all_text` using `kw in all_text`.
5. If a type gets 2+ matches, adds `(doc_type, matches)` to `doc_type_hints`.
6. Sorts `doc_type_hints` descending by match count.
7. Returns:
   ```
   {
     'total_pages': int,
     'total_characters': int,
     'detected_types': [str, str, str],  # top 3 types only
     'sections': [{'section': str, 'page': int}, ...],
     'total_sections': int
   }
   ```

---
---

## `modules/chunking.py`

**Purpose:** Splits page text into fixed-size chunks while preserving page number and section
header metadata. Performs post-processing to expand page references at page boundaries.

**Module-level globals:** `logger = logging.getLogger(__name__)`

Note: `import re` is present at the top of the file but `re` is not used anywhere in the module body.

---

### `chunk_with_page_index(pages_data: List[Dict], chunk_size: int = 800, chunk_overlap: int = 200) -> List[Dict]`

1. If `pages_data` is empty, returns `[]`.
2. Creates `RecursiveCharacterTextSplitter` with:
   - `chunk_size=800`
   - `chunk_overlap=200`
   - `length_function=len`
   - `separators=["\n\n", "\n", ". ", "; ", ", ", " ", ""]`
3. Initializes `current_section = "Document Start"` and `chunk_id = 0`.
4. Iterates over each `page_data` in `pages_data`:
   - If `page_sections` is non-empty: `current_section = page_sections[0]`.
   - If `page_text` is falsy or stripped length < 10: `continue` (page skipped).
   - `splitter.split_text(page_text)` produces a list of text chunks.
   - For each `chunk_text`:
     - If stripped length < 10: `continue` (chunk skipped).
     - `chunk_section = current_section`
     - For each `section` in `page_sections`: if `section.lower()` is found in `chunk_text.lower()[:200]`:
       sets `chunk_section = section`, updates `current_section = section`, breaks.
     - Appends `{'text': chunk_text, 'page': page_num, 'pages': [page_num], 'section': chunk_section, 'chunk_id': chunk_id}`.
     - Increments `chunk_id`.
5. Calls `_merge_boundary_chunks(all_chunks)`.
6. Logs `"📦 Created {len(all_chunks)} section-aware chunks"` at INFO.
7. Returns `all_chunks`.

---

### `_merge_boundary_chunks(chunks: List[Dict]) -> List[Dict]`

Iterates over `chunks` with index `i`:
- Gets `pages` as a set from `chunk['pages']`.
- If `i > 0` and `chunks[i-1]['page'] != chunk['page']`: adds `chunks[i-1]['page']` to `pages`.
- If `i < len(chunks) - 1` and `chunks[i+1]['page'] != chunk['page']`: adds `chunks[i+1]['page']` to `pages`.
- Sets `chunk['pages'] = sorted(pages)`.

Returns modified `chunks` list (mutates in place and returns).

---

### `get_expanded_context(chunks: List[Dict], target_page: int, target_section: str = None) -> List[Dict]`

Defined in this module. Not imported or called anywhere else in the codebase.

Logic:
1. `expanded_pages = {target_page - 1, target_page, target_page + 1}`.
2. For each chunk: if any page in `chunk['pages']` is in `expanded_pages`:
   - If `target_section` is provided: includes chunk if `target_section.lower()` is in `chunk['section'].lower()`,
     OR if the page condition is already met (this means matching chunks are added twice via the elif branch
     — this is a logic redundancy in the code, both branches add the same chunk when only the page condition matches).
   - If `target_section` is None: includes chunk.
3. Returns `relevant_chunks`.

This function is never called from any other file in the project.

---

## `modules/embedding.py`

**Purpose:** Provides a singleton embedding model instance. Returns the same `HuggingFaceEmbeddings`
object on every call after the first.

**Module-level globals:**
- `logger = logging.getLogger(__name__)`
- `_embedding_model = None` — the singleton holder

---

### `get_embedding_model() -> HuggingFaceEmbeddings`

1. If `_embedding_model is not None`: returns `_embedding_model` immediately.
2. Logs `"🔧 Loading embedding model: all-MiniLM-L6-v2..."` at INFO.
3. Creates `HuggingFaceEmbeddings` with:
   - `model_name="sentence-transformers/all-MiniLM-L6-v2"`
   - `model_kwargs={"device": "cpu"}`
   - `encode_kwargs={"normalize_embeddings": True, "batch_size": 32}`
4. Sets global `_embedding_model` to the new instance.
5. Logs `"✅ Embedding model loaded"` at INFO.
6. Returns `_embedding_model`.

The model is downloaded from HuggingFace Hub on first use if not locally cached.
The `HuggingFaceEmbeddings` class used is from `langchain_community.embeddings`, which
is deprecated as of LangChain 0.2.2. The deprecation warning is visible in server logs.
No `HF_TOKEN` is configured; requests to HuggingFace Hub are unauthenticated.

---

## `modules/vector_store.py`

**Purpose:** Creates FAISS vector store from chunk dicts. Provides similarity search with
optional hybrid keyword boosting. Caches vector store to disk as pickle.

**Module-level globals:** `logger = logging.getLogger(__name__)`

---

### `create_vector_store(chunks: List[Dict], cache_path: Optional[str] = None) -> Optional[FAISS]`

1. If `chunks` is empty: logs `"❌ No chunks provided to create vector store"` at ERROR, returns None.
2. If `cache_path` is provided and `os.path.exists(cache_path)`:
   - Opens file in binary read mode, calls `pickle.load(f)`.
   - Logs `"✅ Loaded cached vector store"` at INFO, returns loaded object.
   - On Exception: logs `"⚠️ Failed to load cache, rebuilding: {e}"` at WARNING, continues.
   Note: In practice, `process_pdf()` deletes the cache file before calling this function,
   so this cache-load branch is never reached during normal upload flow.
3. Creates `langchain_core.documents.Document` objects from each chunk with:
   `page_content=chunk['text']`, `metadata={'chunk_id': ..., 'page': ..., 'pages': ..., 'section': ...}`.
4. Calls `get_embedding_model()` to get the singleton model.
5. `FAISS.from_documents(documents, embedding_model)` — builds the index synchronously.
6. Logs `"✅ FAISS vector store created"` at INFO.
7. If `cache_path` is provided:
   - `pickle.dump(vector_store, f)` — writes FAISS object as pickle.
   - Logs `"💾 Vector store cached to {cache_path}"` at INFO.
   - On Exception: logs `"⚠️ Failed to cache vector store: {e}"` at WARNING.
8. Returns `vector_store`.

Outer `try/except Exception` around FAISS building: logs `"❌ Failed to create vector store: {e}"` at ERROR, returns None.

---

### `search_vector_store(vector_store: FAISS, query: str, top_k: int = 6, use_hybrid: bool = True) -> List[Tuple[Document, float]]`

1. `vector_store.similarity_search_with_score(query, k=top_k * 2)` — retrieves `top_k * 2` results.
   Returns `(Document, float)` pairs where float is FAISS L2 distance (lower = more similar).
2. If `use_hybrid=True` (always True in all call sites — no caller passes `use_hybrid=False`):
   - Builds `query_words` as a set of lowercased words from `query`.
   - For each `(doc, score)`: computes word set intersection between `query_words` and
     `set(doc.page_content.lower().split())`. `overlap` = len of intersection.
   - `keyword_boost = overlap * 0.05`
   - `adjusted_score = score - keyword_boost`
   - Sorts ascending by `adjusted_score`, returns first `top_k`.
3. If `use_hybrid=False`: returns `results[:top_k]` (raw FAISS results).

---

## `modules/retriever.py`

**Purpose:** Provides query enhancement, legal-aware reranking, page-context expansion,
and context string assembly.

**Module-level globals:** `logger = logging.getLogger(__name__)`

---

### `enhance_legal_query(query: str) -> str`

Only called from `ask_question()`. Not called from any other analysis function.

1. `query.strip()`.
2. Applies 10 regex substitutions (case-insensitive) using `re.sub()`:
   - `\bwhat's\b` → `what is`
   - `\bhow's\b` → `how is`
   - `\bwhere's\b` → `where is`
   - `\bwho's\b` → `who is`
   - `\bcan't\b` → `cannot`
   - `\bwon't\b` → `will not`
   - `\bdon't\b` → `do not`
   - `\bNDA\b` → `non-disclosure agreement`
   - `\bIP\b` → `intellectual property`
   - `\bToS\b` → `terms of service`
3. Returns modified `query`.

---

### `rerank_legal_contexts(query: str, docs_with_scores: List[Tuple[Document, float]]) -> List[Document]`

Called by all 5 analysis functions. The `query` parameter passed is NOT the same as the
query used for vector search in the same function — each analysis function uses a separate,
shorter query string for reranking than for search.

1. `query_terms = query.lower().split()` — simple whitespace split.
2. Defines `legal_boost_words` as a set of 21 strings:
   `{'obligation', 'shall', 'must', 'liability', 'indemnify', 'terminate', 'breach', 'penalty', 'warranty', 'damages', 'confidential', 'dispute', 'arbitration', 'governing law', 'force majeure', 'intellectual property', 'covenant', 'representations', 'warranties', 'default', 'remedy'}`
3. For each `(doc, score)` in input:
   - `content_lower = doc.page_content.lower()`
   - `tf_score = sum(content_lower.count(term) for term in query_terms)` — total count of each query term across the document
   - `legal_score = sum(1 for word in legal_boost_words if word in content_lower)` — count of present legal words
   - `combined_score = score - (tf_score * 0.02) - (legal_score * 0.01)`
   - Appends `(doc, combined_score)` to `reranked`.
4. Sorts ascending by score.
5. Returns list of `doc` objects only (scores discarded).

---

### `build_legal_context(docs: List[Document], all_chunks: List[Dict] = None) -> Tuple[str, List[Dict]]`

The `all_chunks` parameter is accepted but never referenced inside the function body.
It does nothing.

1. Iterates `docs` with `enumerate(docs, 1)` — source numbering starts at 1.
2. For each doc:
   - Gets `chunk_id = doc.metadata.get('chunk_id', 'N/A')`.
   - If `chunk_id` is in `seen_chunks`: skips (deduplication). The source counter `i` was already
     incremented by `enumerate`, so if a duplicate is skipped, the source numbers in the output
     are not contiguous.
   - Adds `chunk_id` to `seen_chunks`.
   - Gets `page`, `pages`, `section` from metadata.
   - If `len(pages) > 1`: `page_str = f"Pages {pages[0]}-{pages[-1]}"`, else `f"Page {page}"`.
   - Builds entry string: `f"[Source {i} | {page_str} | Section: {section}]\n{doc.page_content}"`.
   - Appends to `context_parts`.
   - Appends source dict `{'source_id': i, 'page': page, 'pages': pages, 'section': section, 'chunk_id': chunk_id}` to `source_info`.
3. `context = "\n\n---\n\n".join(context_parts)`.
4. Returns `(context, source_info)`.

---

### `expand_page_context(primary_docs: List[Document], all_chunks: List[Dict]) -> List[Document]`

1. If `all_chunks` is empty/None/falsy: returns `primary_docs` unchanged.
2. Collects `target_pages` as a set: for each doc, adds `page - 1`, `page`, `page + 1` where `page = doc.metadata.get('page', 0)`.
3. Collects `primary_chunk_ids` as a set from all primary docs.
4. Builds `expanded_docs = list(primary_docs)`.
5. For each `chunk` in `all_chunks`: if `chunk['chunk_id']` not in `primary_chunk_ids` AND `chunk['page']` in `target_pages`:
   - Creates a new `Document(page_content=chunk['text'], metadata={...})` and appends to `expanded_docs`.
6. Returns `expanded_docs[:10]` — hard cap at 10 documents.

---

## `modules/prompt_engine.py`

**Purpose:** Stores all LLM prompt templates as module-level string constants. Provides a
`get_prompt()` lookup function.

**No imports** (only defines string constants and one function).

**Module-level constants:**

### `BARRISTER_SYSTEM_PROMPT`
A multi-line string containing identity, 5 core principles, a fallback instruction, and a disclaimer.
Imported by `legal_analyzer.py` (`from modules.prompt_engine import get_prompt, BARRISTER_SYSTEM_PROMPT`)
but never passed to any `ChatPromptTemplate` or LLM call in `legal_analyzer.py`.

### `FULL_ANALYSIS_PROMPT`
Template variables: `{context}`, `{total_pages}`, `{doc_type}`, `{sections_summary}`.
Specifies 9 output sections with exact Markdown headers and emoji prefixes.
Ends with: `"IMPORTANT: Base ALL answers on the provided context only."`
Does NOT contain the disclaimer from `BARRISTER_SYSTEM_PROMPT`.

### `QUESTION_ANSWER_PROMPT`
Template variables: `{context}`, `{question}`.
Specifies 2 output sections: `## Answer` and `## 📌 Source`.
Contains fallback language: `"This information is not found in the provided document."`
Contains: `"DISCLAIMER: This is an AI-based analysis and not legal advice."`
This is the only prompt that contains the disclaimer.

### `SUMMARY_PROMPT`
Template variables: `{context}`, `{total_pages}`, `{doc_type}`.
Specifies 3 output sections.
Does NOT contain the disclaimer.

### `RISK_ANALYSIS_PROMPT`
Template variables: `{context}` only.
Specifies 4 output sections including "One-Sided Clauses", "Unlimited Liability", etc.
Does NOT contain the disclaimer.

### `KEY_POINTS_PROMPT`
Template variables: `{context}` only.
Specifies 6 sub-sections under `## 🔑 Key Points`.
Does NOT contain the disclaimer.

### `get_prompt(analysis_type: str) -> str`
Looks up `analysis_type` in a dict mapping 5 keys to the 5 prompt constants.
If key not found, returns `QUESTION_ANSWER_PROMPT` as default.
Keys: `'full_analysis'`, `'question'`, `'summary'`, `'risk_analysis'`, `'key_points'`.

---
---

# Frontend Review

---

## HTML Structure (`templates/index.html`)

**Document-level:**
- `lang="en"`, UTF-8 charset, viewport meta tag for responsive design.
- `<meta name="description">` contains "Barrister Pro — Professional legal document analysis."
- `<title>` is "Barrister Pro | Legal Intelligence".
- Loads `style.css` via Flask's `url_for('static', ...)`.
- Loads Font Awesome 6.4.0 from `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css`.

**Root layout element:** `<div class="app-layout">` — flex container, full viewport.

**Sidebar (`<aside class="sidebar">`):**
- Header with inline SVG logo (scales-of-justice design, gold color from CSS var) and `<h1 class="sidebar-title">Barrister Pro</h1>`.
- Nav section with 2 group labels and 6 buttons:
  - "AI Intelligence" (`onclick="showView('workspace')"`, initially `active`)
  - "Full Legal Audit" (`id="navFull"`, initially `disabled`)
  - "Executive Summary" (`id="navSummary"`, initially `disabled`)
  - "Risk Assessment" (`id="navRisks"`, initially `disabled`)
  - "Key Obligations" (`id="navKeys"`, initially `disabled`)
  - "New Analysis" (`onclick="resetWorkspace()"`)
- Footer with static text "Legal Intelligence Secured" and a green status dot.

**Main content (`<main class="main-content">`):**
- Top nav bar (72px height) containing:
  - `id="docPill"` — hidden by default (`style="display: none;"`), shows filename after upload
  - `id="appStatus"` — shows "⚖️ System Ready" with class `header-badge` (no CSS definition for this class exists in style.css)

**Workspace div (`id="workspace"`):**

Two child sections, only one visible at a time:

**Upload section (`id="uploadSection"`):**
- `<div class="pro-upload" id="uploadArea">` — click handler triggers `document.getElementById('fileInput').click()`.
- `<input type="file" id="fileInput" accept=".pdf" hidden>` — file picker, hidden.
- `id="uploadStatus"` — empty div, shown by JS with status messages.
- `id="scanner"` — `.scanner-line` div, `display: none` by default, animated scan line shown during upload.
- `id="docStats"` — `.stats-grid`, `display: none` by default. Contains three `.stat-item` divs:
  - `id="infoPages"` — Document Pages
  - `id="infoSections"` — Identified Sections
  - `id="infoChars"` — Character Units

**Intelligence area (`id="intelligenceArea"`, `display: none` initially):**
- `<div class="split-view">` — CSS grid, 2 columns: `1fr` and `400px`.
- Left column: `<div class="analysis-area" id="reportsArea">` — empty, report cards prepended here.
- Right column: `<div class="pro-chat">` — sticky chat panel:
  - Header: "Barrister AI" title, `id="chatStatus"` status indicator.
  - `id="chatMessages"` — scrollable message container, initial bot message present in HTML.
  - Input area: `<textarea id="questionInput">`, `id="sendBtn"` (send), `id="stopBtn"` (stop, hidden by default).

`<script>` tag loads `script.js` via `url_for` at bottom of body.

---

## JavaScript Architecture (`static/js/script.js`)

**Module-level state (two variables):**
```javascript
let isProcessing = false;
let abortController = null;
```
`isProcessing` is a boolean flag preventing concurrent operations.
`abortController` is a single `AbortController` instance, replaced on each new fetch operation.

**Initialization (`DOMContentLoaded`):**
- Attaches click listeners to `navFull`, `navSummary`, `navRisks`, `navKeys` calling `runAnalysis()` with type strings.
- Attaches `change` listener to `fileInput` → calls `handleUpload(file)` on first file.
- Attaches `dragover`, `dragleave`, `drop` listeners to `uploadArea`.
  - `dragover`: prevents default, adds `.active` class to `uploadArea`.
  - `dragleave`: removes `.active` class.
  - `drop`: prevents default, removes `.active` class, reads `e.dataTransfer.files[0]`.
    Validates `file.type === 'application/pdf'` (MIME type check, different from server-side extension check).
    Calls `handleUpload(file)` if valid. Calls `updateStatus('❌ Invalid file type. PDF only.', 'error')` if invalid.
- Attaches `keydown` listener to `questionInput`: calls `askQuestion()` on Enter (without Shift).
- Calls `showView('workspace')`.

---

### `showView(viewId)`

Iterates `['workspace']` (hardcoded array with one element).
Sets `display: block` for matching element, `display: none` for others.
Iterates all `.nav-item` elements: adds `active` to items whose `onclick` or `id` contains `viewId`.
Removes `active` only from items whose `onclick` contains `'showView'`.

---

### `handleUpload(file)` — async

1. Returns immediately if `isProcessing`.
2. Sets `isProcessing = true`.
3. Creates `FormData`, appends `file` under key `'file'`.
4. Calls `updateStatus('📄 Initializing Professional Analysis...', 'loading')`.
5. Shows `#scanner` element.
6. `fetch('/upload', {method: 'POST', body: formData})` — no `Content-Type` header (browser sets multipart boundary automatically).
7. On success (`data.success`):
   - Calls `updateStatus(...)` with filename.
   - Calls `renderDocInfo(data.doc_info, data.filename)`.
   - Calls `enableSidebarActions(true)`.
   - Sets `#uploadSection` opacity to 0 via inline style + transition.
   - After 500ms timeout: hides `#uploadSection`, shows `#intelligenceArea`, sets its opacity to 0.
   - After 50ms nested timeout: sets opacity to 1 with transition.
8. On error (`data.success` false): calls `updateStatus('❌ Analysis Error: ...', 'error')`.
9. On fetch exception: calls `updateStatus('❌ Connection failed. Check server.', 'error')`, `console.error()`.
10. Finally: sets `isProcessing = false`, hides `#scanner`.

---

### `renderDocInfo(info, filename)`

Shows `#docPill` as `inline-flex`, sets `#docName` text.
Shows `#docStats` as `grid`.
Sets `#infoPages`, `#infoSections`, `#infoChars` text content from `info` object.
`#infoChars` is formatted via `formatChars()`.

---

### `enableSidebarActions(enabled)`

Iterates `['navFull', 'navSummary', 'navRisks', 'navKeys']`.
Sets `btn.disabled = !enabled`.
If `enabled`, adds class `ready` to btn. The CSS class `ready` on `.nav-item` is not defined in `style.css`.

---

### `runAnalysis(type)` — async

1. Returns if `isProcessing`.
2. Looks up `type` in endpoint config map:
   - `'full'` → `{url: '/analyze', key: 'analysis', label: 'Pro Legal Audit'}`
   - `'summary'` → `{url: '/summary', key: 'summary', label: 'Executive Summary'}`
   - `'risks'` → `{url: '/risks', key: 'risk_analysis', label: 'Risk Assessment'}`
   - `'keypoints'` → `{url: '/keypoints', key: 'key_points', label: 'Key Obligations'}`
3. If config not found: sets `isProcessing = false`, returns.
4. Calls `addBotMessage()` with a loading spinner HTML.
5. Calls `updateChatStatus('Analyzing...', true)`.
6. Calls `toggleProcessing(true)`.
7. Creates new `AbortController`, assigns to `abortController`.
8. `fetch(config.url, {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: abortController.signal})` — no body.
9. On success: removes loading message, calls `addReportCard()`, adds completion bot message.
10. On error: removes loading message. If `AbortError`, does nothing (handled in `stopProcess`). Otherwise calls `addBotMessage('❌ Intelligent engine is temporarily unavailable.')`.
11. Finally: `toggleProcessing(false)`, `updateChatStatus('Ready', false)`.

---

### `stopProcess()`

Calls `abortController.abort()` if `abortController` exists.
Calls `addBotMessage('🛑 Process stopped by user.')`.
Does not reset `isProcessing` here — `toggleProcessing(false)` in the `finally` block of the caller handles it.

---

### `toggleProcessing(processing)`

Sets `isProcessing = processing`.
Hides `#sendBtn` and shows `#stopBtn` when `processing=true`.
Reverses when `processing=false`.

---

### `resetWorkspace()`

1. Calls `abortController.abort()` if exists.
2. Sets `isProcessing = false`.
3. Hides `#intelligenceArea`, shows `#uploadSection` with opacity 1.
4. Hides `#docPill`, `#docStats`, `#uploadStatus`.
5. Clears `#fileInput` value.
6. Sets `#chatMessages` innerHTML to a single bot message.
7. Clears `#reportsArea` innerHTML.
8. Calls `enableSidebarActions(false)`, `toggleProcessing(false)`.

---

### `addReportCard(title, content, sources)`

Creates a `<div class="report-card">` with a unique `id="report-{Date.now()}"`.
Injects inner HTML with a `.report-header` (title + close button) and `.report-body`.
`.report-body` contains `formatMarkdown(content)` + `renderSources(sources)`.
Close button uses `onclick="removeMessage('${cardId}')"`.
Prepends card to `#reportsArea` (newest first).
Calls `card.scrollIntoView({behavior: 'smooth', block: 'start'})`.

---

### `askQuestion()` — async

1. Reads `questionInput.value.trim()`. Returns if empty or `isProcessing`.
2. Calls `addUserMessage(question)`.
3. Clears input, resets height.
4. Calls `addBotMessage('<div class="pro-spinner"></div> Synthesizing answer...')`.
5. Calls `updateChatStatus('Synthesizing...', true)`, `toggleProcessing(true)`.
6. Creates new `AbortController`.
7. `fetch('/ask', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({question}), signal: ...})`.
8. On success: removes loading message, calls `addBotMessage(data.answer, data.sources)`.
9. On error: removes loading message. AbortError is caught but no message is shown (comment says "Already handled in stopProcess message"). Other errors: `addBotMessage('❌ Connection to AI heart failed.')`.
10. Finally: `toggleProcessing(false)`, `updateChatStatus('Ready', false)`, `input.focus()`.

---

### `addUserMessage(text)`

Creates a `<div class="msg user">`, sets `textContent = text` (not innerHTML — text is escaped).
Appends to `#chatMessages`. Calls `scrollChat()`.

---

### `addBotMessage(html, sources)`

Creates a `<div class="msg bot">` with `id="msg-{Date.now()}"`.
Sets innerHTML to `<div>${formatMarkdown(html)}</div>` + `renderSources(sources)` if sources provided.
Appends to `#chatMessages`. Calls `scrollChat()`. Returns the `msgId`.

---

### `removeMessage(id)`

Finds element by id. Calls `.remove()` if found.

---

### `scrollChat()`

Sets `#chatMessages.scrollTop = scrollHeight` (scrolls to bottom).

---

### `updateStatus(msg, type)`

Sets `#uploadStatus` text content, className (`'upload-status ' + type`), display to `'block'`.
The CSS classes `upload-status loading`, `upload-status success`, `upload-status error` are referenced
here but not defined in `style.css`.

---

### `updateChatStatus(text, loading)`

Sets `#chatStatus` innerHTML to a span with conditional inline style for warning color when loading.

---

### `formatChars(count)`

Returns `'0'` if falsy. Returns `(count/1M).toFixed(1) + 'M'` if > 1,000,000.
Returns `(count/1K).toFixed(1) + 'K'` if > 1,000. Returns `count` otherwise.

---

### `renderSources(sources)`

If no sources or empty array: returns `''`.
Produces `[...new Set(sources.map(s => 'P' + s.page))]` — unique page references deduplicated.
Returns an HTML div string with `border-left: 2px solid var(--clr-gold)` inline style
and the text `"Evidence Index: P1, P3, ..."`.

---

### `formatMarkdown(text)`

1. If `text` is falsy: returns `''`.
2. If `text` includes `'<div'` or `'<span'`: returns `text` unchanged.
3. Applies regex replacements in order:
   - `/## (.+)/g` → `<h2>$1</h2>`
   - `/### (.+)/g` → `<h3>$1</h3>`
   - `/\*\*(.+?)\*\*/g` → `<strong>$1</strong>`
   - `/\* (.+)/g` → `<li>$1</li>`
   - `/<li>(.+)<\/li>\n<li>/g` → `<li>$1</li><li>` (attempts to join adjacent list items)
4. Splits by `'\n\n'`, wraps each piece in `<p>...</p>` with `\n` replaced by `<br>`.
5. Joins all `<p>` elements.

`# ` (single hash) headings are not handled. Only `##` and `###` are converted.

---
# CSS Review placeholder

---

## CSS Review (`static/css/style.css`)

**Imports:**
First line: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@500;600;700&display=swap');`
Loads Inter (weights 300–800) and Playfair Display (weights 500–700) from Google Fonts.

**CSS Custom Properties (`:root`):**

Color palette:
- `--clr-navy-deep: #05080f`
- `--clr-navy-main: #0a0e1a`
- `--clr-navy-light: #121829`
- `--clr-slate-main: #1f2937`
- `--clr-slate-light: #374151`
- `--clr-gold: #c5a059`
- `--clr-gold-light: #e6d5b8`
- `--clr-gold-dark: #8e6c2f`
- `--clr-gold-soft: rgba(197, 160, 89, 0.1)`
- `--clr-gold-glow: rgba(197, 160, 89, 0.2)`

Text:
- `--txt-heading: #f9fafb`
- `--txt-body: #d1d5db`
- `--txt-muted: #9ca3af`
- `--txt-accent: #c5a059`

Status:
- `--clr-success: #10b981`
- `--clr-danger: #ef4444`
- `--clr-warning: #f59e0b`
- `--clr-info: #3b82f6`

Components:
- `--bg-glass: rgba(15, 23, 42, 0.85)`
- `--border: rgba(255, 255, 255, 0.08)`
- `--border-gold: rgba(197, 160, 89, 0.2)`

Layout:
- `--sidebar-width: 280px`
- `--radius-sm: 8px`
- `--radius-md: 12px`
- `--radius-lg: 20px`
- `--transition: cubic-bezier(0.16, 1, 0.3, 1)`

**Global reset:** `* { margin: 0; padding: 0; box-sizing: border-box; }`

**body:**
Font: `'Inter', -apple-system, sans-serif`. Background: `--clr-navy-deep`. Color: `--txt-body`.
`overflow: hidden` set on body. `-webkit-font-smoothing: antialiased`.
`body::before` pseudo-element: fixed position, full inset, two radial gradients (gold at top-left, dark navy at bottom-right), `pointer-events: none`, `z-index: -1`.

**Layout classes:**
- `.app-layout`: `display: flex; height: 100vh; width: 100vw`
- `.sidebar`: fixed width `280px`, `background: var(--bg-glass)`, `backdrop-filter: blur(20px)`, flex column, `z-index: 100`
- `.main-content`: `flex: 1`, flex column, `overflow: hidden`
- `.workspace`: `flex: 1`, `overflow-y: auto`, `padding: 2rem`, flex column, `gap: 2rem`, `scroll-behavior: smooth`

**Sidebar scrollbar (webkit):** custom 8px scrollbar on `.workspace`, transparent track, `--clr-navy-light` thumb with 4px border radius.

**Split view:** `.split-view { display: grid; grid-template-columns: 1fr 400px; gap: 2rem; align-items: start; }`

**Chat panel:** `.pro-chat { position: sticky; top: 0; height: calc(100vh - 120px); ... backdrop-filter: blur(20px); }`

**Report body typography overrides:** Rules scoped to `.report-body` override heading colors:
- `h2`: `--clr-gold`, `Playfair Display`, border-bottom `--border-gold`
- `h3`: `--clr-gold-light`
- `strong`: `--clr-gold-light`

**Animations defined:**
- `@keyframes slideUp`: opacity 0 + translateY(20px) → opacity 1 + translateY(0)
- `@keyframes fadeIn`: opacity 0 → 1
- `@keyframes scan`: `top` moves from 0 to 100%, opacity 0→1→0 over 2 seconds
- `@keyframes spin`: `transform: rotate(360deg)`

Applied: `.report-card` uses `slideUp 0.6s`, `.msg` uses `fadeIn 0.3s`, `.scanner-line` uses `scan 2s linear infinite`, `.pro-spinner` uses `spin 0.8s linear infinite`.

**Pro spinner:** 20×20px circle, 2px border, gold top-color, spins continuously.

**Responsive breakpoints:**

At `max-width: 1200px`:
- `.split-view`: collapses to single column (`grid-template-columns: 1fr`)
- `.pro-chat`: `position: relative`, `height: 500px`, `top: auto`

At `max-width: 768px`:
- `.sidebar`: `position: fixed`, `transform: translateX(-100%)`, `transition: transform 0.3s`
- `.sidebar.open`: `transform: translateX(0)` — this class is never set by any JavaScript in `script.js`, so the sidebar is permanently hidden on mobile screens
- `.top-nav`: `padding: 0 1rem`
- `.workspace`: `padding: 1rem`

**CSS classes referenced by JavaScript but not defined in style.css:**
- `.header-badge` (used on `#appStatus` in HTML)
- `.upload-status`, `.upload-status.loading`, `.upload-status.success`, `.upload-status.error` (set via JS `updateStatus()`)
- `.nav-item.ready` (added by `enableSidebarActions()`)

---

# Data Flow

This section documents the exact sequence of data movement from user interaction to browser response.

---

## Upload Flow

User action: selects or drops a PDF file in the browser.

1. Browser triggers handleUpload(file).
2. FormData object created, file appended under key 'file'.
3. etch('/upload', {method: 'POST', body: formData}) — multipart POST with no explicit Content-Type (browser sets it with boundary).
4. Flask receives request in upload_file().
5. File validated (extension check only).
6. secure_filename() applied → ilename.
7. ile.save('uploads/{filename}') — written to local disk.
8. process_pdf('uploads/{filename}') called synchronously in request thread:
   a. load_pdf_with_pages():
      - PdfReader opens the file.
      - For each page: page.extract_text() returns string (or empty string for image pages).
      - ix_doubled_text() applied to each page text.
      - detect_section_header() called per line → sections list per page.
      - Returns List[{'page': int, 'text': str, 'sections': List[str]}].
   b. get_document_info(pages_data):
      - Concatenates all text, lowercases.
      - Checks 12 document type keyword lists.
      - Returns doc_info dict.
   c. chunk_with_page_index(pages_data):
      - RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=200) created.
      - Iterates pages, splits each page text into chunks.
      - current_section variable updated per page, propagated to each chunk.
      - Each chunk dict: {text, page, pages:[page], section, chunk_id}.
      - _merge_boundary_chunks() adds adjacent page numbers to boundary chunks.
      - Returns List[Dict].
   d. cache_path = '{basename}.pkl'. Existing file deleted.
   e. create_vector_store(chunks, cache_path):
      - Document objects created from chunks with metadata.
      - get_embedding_model() returns singleton (loads from HuggingFace on first call).
      - FAISS.from_documents(documents, model) builds index in RAM.
      - Pickle-serializes FAISS to cache_path.
      - Returns FAISS object.
9. document_store[session_id] = {filepath, filename, pages_data, chunks, vector_store, doc_info}.
10. Session cookie updated with session_id, current_pdf, current_filename.
11. JSON response returned: {success, message, filename, doc_info: {total_pages, total_sections, detected_types, total_characters}}.
12. Browser receives response. enderDocInfo() updates stats. enableSidebarActions(true). Transition to intelligence view.

---

## Analysis Flow (Full Analysis example, /analyze)

User action: clicks 'Full Legal Audit' sidebar button.

1. unAnalysis('full') called.
2. isProcessing check — returns if already processing.
3. ddBotMessage('<div class="pro-spinner"></div> ...') — loading indicator in chat.
4. 	oggleProcessing(true) — hides send button, shows stop button.
5. New AbortController created.
6. etch('/analyze', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal}) — no request body.
7. Flask nalyze() handler receives request.
8. _get_document_data() → looks up document_store[session_id] from cookie.
9. ull_analysis(vector_store, chunks, doc_info) called:
   a. search_vector_store(vector_store, 'legal terms obligations rights', top_k=10):
      - similarity_search_with_score(query, k=20) on FAISS index.
      - Hybrid boost: word overlap × 0.05 subtracted from scores.
      - Returns top 10 (Document, float) pairs.
   b. erank_legal_contexts('legal terms obligations rights conditions', results):
      - TF score + legal keyword count computed per document.
      - combined_score = faiss_score - (tf_score × 0.02) - (legal_score × 0.01).
      - Re-sorted ascending. Returns List[Document].
   c. expand_page_context(docs, chunks):
      - Target pages = {page-1, page, page+1} for all retrieved docs.
      - Non-duplicate chunks from adjacent pages added.
      - Capped at 10 documents total.
   d. uild_legal_context(docs, chunks):
      - Deduplicates by chunk_id.
      - Formats each doc as '[Source N | Page X | Section: Y]\n{text}'.
      - Joins with '\n\n---\n\n'.
      - Returns (context_string, source_info_list).
   e. sections_summary built from all chunk section labels.
   f. doc_type built from doc_info['detected_types'].
   g. ChatPromptTemplate.from_messages([('user', FULL_ANALYSIS_PROMPT)]) constructed.
   h. _invoke_llm_with_fallback(prompt_template, {context, total_pages, doc_type, sections_summary}):
      - Creates ChatOpenAI for google/gemma-3-12b-it:free.
      - chain.invoke(variables) → HTTP POST to https://openrouter.ai/api/v1/chat/completions.
      - If response len > 20: returns esponse.content.strip().
      - On failure: sleeps 2s, tries next model. Repeats for all 3.
      - If all fail: returns error string literal.
   i. Returns {analysis: answer, sources: source_info, doc_info: doc_info}.
10. Flask route returns {success: true, analysis: result['analysis'], sources: result['sources']}.
    Note: esult['doc_info'] is discarded and not sent to client.
11. Browser receives response.
12. emoveMessage(loadingId) removes spinner.
13. ddReportCard('Pro Legal Audit', data.analysis, data.sources) creates and prepends report card.
14. ormatMarkdown(content) converts Markdown to HTML inside the card.
15. enderSources(data.sources) appends Evidence Index below content.
16. ddBotMessage(...) adds completion message to chat.
17. 	oggleProcessing(false) restores send button.

---

## Q&A Flow (/ask)

User action: types a question and presses Enter or the send button.

1. skQuestion() reads questionInput.value.trim().
2. ddUserMessage(question) — renders user bubble in chat.
3. Clears input field.
4. etch('/ask', {method: 'POST', body: JSON.stringify({question})}).
5. Flask sk_question_route() reads data.get('question', '').strip().
6. sk_question(vector_store, chunks, doc_info, question) called:
   a. enhance_legal_query(question) — regex substitution on abbreviations.
   b. search_vector_store(vector_store, enhanced_query, top_k=6) — FAISS k=12, returns top 6.
   c. erank_legal_contexts(enhanced_query, results).
   d. expand_page_context(docs, chunks) — cap 10.
   e. uild_legal_context(docs, chunks).
   f. ChatPromptTemplate.from_messages([('user', QUESTION_ANSWER_PROMPT)]).
   g. _invoke_llm_with_fallback(prompt_template, {context, question}).
      Note: question here is the original unenhanced question, not enhanced_query.
   h. Returns {answer: str, sources: List[Dict]}.
7. Browser receives {success, answer, sources}.
8. ddBotMessage(data.answer, data.sources) renders in chat with sources.
