# DATABASE.md — Barrister AI

## Summary

Barrister AI has no database. There is no SQL database, no NoSQL store, no Redis, and no ORM anywhere in the codebase.

---

## What Exists Instead

### 1. In-Memory Python Dictionary (`document_store`)

**Location:** `app.py`, line 48

```python
document_store = {}
```

This is a module-level dictionary that acts as the only data store while the server is running.

**Structure:**

```
document_store = {
    "<session_id: str>": {
        "filepath":    str,         # Absolute path to the uploaded PDF on disk
        "filename":    str,         # Sanitised filename
        "pages_data":  List[Dict],  # Raw per-page extraction from pdf_loader
        "chunks":      List[Dict],  # All text chunks with metadata from chunking
        "vector_store": FAISS,      # In-memory FAISS index object
        "doc_info":    Dict         # Document metadata (pages, sections, types)
    }
}
```

**Lifetime:** Process lifetime only. Every server restart wipes all data.

**Key:** `session_id` — a random 8-byte hex token stored in Flask's signed cookie session.

---

### 2. Pickle File Cache (`.pkl` files)

**Location:** Project root directory

**Files observed:**
- `sample.pdf.pkl`
- `2781092400045.pdf.pkl`

**Format:** Python `pickle` serialisation of a `langchain_community.vectorstores.faiss.FAISS` object.

**Purpose:** Cache the FAISS vector store between server restarts so re-uploading the same file does not require re-embedding.

**Cache key:** The basename of the uploaded PDF file (`os.path.basename(pdf_path) + ".pkl"`).

**Invalidation:** On every upload, the code explicitly deletes the existing cache file for that filename before rebuilding:

```python
if os.path.exists(cache_path):
    try:
        os.remove(cache_path)
    except Exception:
        pass
```

This means the cache does NOT provide persistence across uploads of the same file — it is only used if the cache file exists AND was not just deleted (which it always is). The cache effectively does nothing for re-uploads. It would only preserve state if the server restarted and a `.pkl` file was left over from a previous run, but even then the `document_store` dict would be empty, so the user would still need to re-upload.

---

### 3. Uploaded Files on Disk

**Location:** `uploads/` directory

**Format:** Raw PDF files saved with `werkzeug.utils.secure_filename`

**Lifetime:** Permanent (files are never deleted by the application).

**Files observed in uploads/:**
- `sample.pdf`
- `2781092400045.pdf`

---

### 4. Flask Cookie Session

**Storage:** Client-side signed cookie (Flask default)

**Contents:**
- `session_id` — links the browser to the server-side `document_store` entry
- `current_pdf` — filepath of the currently active document
- `current_filename` — filename of the currently active document

**Signing:** Flask's `secret_key` (set from `FLASK_SECRET_KEY` env var, or randomly generated at startup if not set)

---

## What Is Not Persisted

| Data | Status |
|---|---|
| User accounts | Does not exist |
| Usage history | Does not exist |
| Past analyses | Does not exist |
| Document metadata across sessions | Does not exist |
| Chunks or embeddings across restarts | Lost on restart |
| Analysis results | Not stored anywhere |
