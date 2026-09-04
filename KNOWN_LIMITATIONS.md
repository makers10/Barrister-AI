# KNOWN_LIMITATIONS.md — Barrister AI

These are limitations that can be directly identified from reading the code and logs. Nothing here is speculative.

---

## 1. No Persistence Across Server Restarts

`document_store` is a Python in-memory dictionary in `app.py`. Every time the Flask process restarts, all processed document data is lost. Users must re-upload their document.

The `.pkl` cache files on disk preserve the FAISS index, but since the code deletes the cache on every upload (`os.remove(cache_path)`) before rebuilding it, the cache does not provide meaningful cross-restart persistence.

---

## 2. Scanned / Image-Based PDFs Are Not Supported

The PDF loader uses `PyPDF2.PdfReader` with `page.extract_text()`. This only works on PDFs with embedded text layers. Scanned PDFs (images of pages with no text layer) return empty strings.

The upload handler explicitly handles this case and returns an error: `"Failed to extract text from PDF. The file may be empty or a scanned image."`

There is no OCR pipeline in the codebase.

---

## 3. LLM Models Are Free-Tier and Unreliable

All three models in the fallback chain are free-tier OpenRouter models:

- `google/gemma-3-12b-it:free`
- `mistralai/mistral-small-3.1-24b-instruct:free`
- `meta-llama/llama-3.2-3b-instruct:free`

Free-tier models on OpenRouter are subject to rate limits, availability changes, and quality degradation. The fallback mechanism sleeps 2 seconds between retries, meaning a full fallback through all three models adds up to 4 seconds of sleep plus three timeout windows of up to 35 seconds each (worst case: ~109 seconds total before giving up).

---

## 4. `max_tokens=2000` May Truncate Full Analysis

The LLM is configured with `max_tokens=2000`. The `FULL_ANALYSIS_PROMPT` asks for 9 structured sections (Document Overview, Short Summary, Detailed Summary, Key Points, Supported Rules, Violated Rules, Missing Rules, Risks, Suggestions). For long or complex documents, the 2000-token limit may cause the response to be cut off mid-analysis.

---

## 5. One Document Per Session

The application architecture supports exactly one active document per user session. Uploading a new document replaces the previous one in `document_store[session_id]`. There is no multi-document support or document history.

---

## 6. No Multi-User Isolation at the Memory Level

`document_store` is a module-level global dict shared across all Flask worker threads/processes. With Flask's default single-threaded development server this is harmless, but it is not designed for multi-process deployment (e.g., Gunicorn with multiple workers would give each worker its own empty `document_store`).

---

## 7. Section Detection Is Heuristic and Incomplete

`detect_section_header()` in `pdf_loader.py` uses regex patterns designed for common English legal document structures. It will miss section headers that don't match any of its 11 patterns. For example, headers in all-lowercase, headers with non-standard numbering schemes, or headers in languages other than English will not be detected.

From the server log, `2781092400045.pdf` — a 2-page document — extracted 2631 characters but detected **0 sections**, which means all chunks were assigned the default section label `"Document Start"`.

---

## 8. English Only

The prompt templates, section header patterns, abbreviation expansion, and legal keyword boost lists are all in English. Non-English documents will load and embed (the embedding model is multilingual to a degree), but the analysis quality will be significantly lower as the prompts are English-only and the section header regex will not match non-English patterns.

---

## 9. `BARRISTER_SYSTEM_PROMPT` Is Defined but Not Used

`modules/prompt_engine.py` defines a `BARRISTER_SYSTEM_PROMPT` constant that documents core principles for the LLM (structure-first, page index, no hallucination, etc.). However, `modules/legal_analyzer.py` constructs all prompts using:

```python
ChatPromptTemplate.from_messages([("user", get_prompt('...'))])
```

All prompts are sent as single `user` role messages. The system prompt is never passed to the LLM as a `system` role message. The instructions from `BARRISTER_SYSTEM_PROMPT` are partially duplicated inside the individual prompt templates.

---

## 10. Filename Collision Risk

Uploaded files are saved as `uploads/<secure_filename>`. If two users upload files with the same name (e.g., `contract.pdf`), the second upload overwrites the first on disk. The corresponding `.pkl` cache file would also be overwritten. Since there is no user separation, the second user's analysis could potentially conflict with the first.

---

## 11. No Favicon

The server log shows a 404 for `/favicon.ico` — there is no favicon configured.

---

## 12. Deprecated Dependency

`HuggingFaceEmbeddings` from `langchain_community` is deprecated as of LangChain 0.2.2 and will be removed in LangChain 1.0 (per the deprecation warning in the server log). The replacement is `langchain_huggingface.HuggingFaceEmbeddings`.

---

## 13. No Abort in Analysis Endpoints

The frontend has a stop button that calls `AbortController.abort()` on the fetch request. This cancels the HTTP request from the browser's perspective, but **does not stop the server-side processing**. The Flask handler will continue running the LLM call to completion even after the client disconnects.

---

## 14. `fix_doubled_text()` Heuristic May Corrupt Normal Text

The doubled-character fix in `pdf_loader.py` applies a heuristic based on a 500-character sample. If a PDF has an unusual but valid character distribution that accidentally triggers the >60% threshold, the function will incorrectly remove characters from normal text.
