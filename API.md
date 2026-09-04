# API.md — Barrister AI

## Overview

Barrister AI exposes a simple HTTP API served by Flask. All endpoints are on the same host and port as the web UI. There is no versioning, no API key requirement, and no authentication on any endpoint.

Sessions are tracked via Flask's signed cookie. All analysis endpoints (`/analyze`, `/summary`, `/risks`, `/keypoints`, `/ask`) require that a document was previously uploaded in the same browser session.

---

## Base URL

```
http://127.0.0.1:8080
```

(Port is set by `FLASK_PORT` in `.env`. Default in code is 5000; the `.env` sets it to 8080.)

---

## Endpoints

---

### `GET /`

Returns the single-page HTML application.

**Response:** `text/html` — renders `templates/index.html`

---

### `POST /upload`

Upload and process a PDF document.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | PDF file to analyse. Must have `.pdf` extension. |

**Constraints:**
- File must have a `.pdf` extension (checked by string comparison, not MIME type)
- Max file size: 200 MB (enforced by Flask `MAX_CONTENT_LENGTH`)

**Success Response:** `200 OK` — `application/json`

```json
{
  "success": true,
  "message": "Legal document processed successfully",
  "filename": "example.pdf",
  "doc_info": {
    "total_pages": 5,
    "total_sections": 12,
    "detected_types": ["Employment Agreement", "Non-Disclosure Agreement"],
    "total_characters": 18432
  }
}
```

**Error Responses:** `application/json`

| Status | Condition | Example body |
|---|---|---|
| `400` | No file in request | `{"error": "No file provided"}` |
| `400` | Empty filename | `{"error": "No file selected"}` |
| `400` | Non-PDF file | `{"error": "Invalid file type. Please upload a PDF document."}` |
| `500` | PDF has no extractable text | `{"error": "Failed to extract text from PDF. The file may be empty or a scanned image."}` |
| `500` | No chunks created | `{"error": "Failed to create document chunks. The PDF may not contain readable text."}` |
| `500` | FAISS index creation failed | `{"error": "Failed to create search index."}` |
| `500` | Unexpected exception | `{"error": "Server error: <exception message>"}` |

**Side effects:**
- Saves the PDF to `uploads/<filename>` on disk
- Deletes any existing `.pkl` cache for that filename
- Stores processed data in `document_store[session_id]`
- Sets `session_id`, `current_pdf`, `current_filename` in Flask session cookie

---

### `POST /analyze`

Run a full legal analysis on the currently uploaded document.

**Request:** No body required.

**Success Response:** `200 OK` — `application/json`

```json
{
  "success": true,
  "analysis": "<markdown string — full analysis text>",
  "sources": [
    {
      "source_id": 1,
      "page": 2,
      "pages": [1, 2, 3],
      "section": "ARTICLE 1: DEFINITIONS",
      "chunk_id": 4
    }
  ]
}
```

**Error Responses:**

| Status | Condition | Example body |
|---|---|---|
| `400` | No document uploaded in session | `{"error": "Please upload a document first."}` |
| `500` | Unexpected exception | `{"error": "Analysis failed: <exception message>"}` |

**Notes:**
- Retrieves top 10 chunks from the vector store using the query `"legal terms obligations rights"`
- LLM is invoked with the `FULL_ANALYSIS_PROMPT` template
- Falls back through up to 3 LLM models if earlier ones fail

---

### `POST /summary`

Generate a structured summary of the current document.

**Request:** No body required.

**Success Response:** `200 OK` — `application/json`

```json
{
  "success": true,
  "summary": "<markdown string>",
  "sources": [ ... ]
}
```

**Error Responses:** Same pattern as `/analyze`.

**Notes:** Retrieves top 8 chunks using query `"summary overview purpose scope"`.

---

### `POST /risks`

Perform risk and red flag analysis on the current document.

**Request:** No body required.

**Success Response:** `200 OK` — `application/json`

```json
{
  "success": true,
  "risk_analysis": "<markdown string>",
  "sources": [ ... ]
}
```

**Error Responses:** Same pattern as `/analyze`.

**Notes:** Retrieves top 8 chunks using query `"liability risk penalty termination breach indemnify limitation"`.

---

### `POST /keypoints`

Extract key obligations, rights, payment terms, deadlines, and penalties.

**Request:** No body required.

**Success Response:** `200 OK` — `application/json`

```json
{
  "success": true,
  "key_points": "<markdown string>",
  "sources": [ ... ]
}
```

**Error Responses:** Same pattern as `/analyze`.

**Notes:** Retrieves top 8 chunks using query `"obligations rights payment deadline penalty condition"`.

---

### `POST /ask`

Answer a specific natural language question about the current document.

**Request:** `application/json`

```json
{
  "question": "What is the notice period for termination?"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `question` | string | Yes | The question to ask. Must be non-empty after stripping whitespace. |

**Success Response:** `200 OK` — `application/json`

```json
{
  "success": true,
  "answer": "<markdown string>",
  "sources": [ ... ]
}
```

**Error Responses:**

| Status | Condition | Example body |
|---|---|---|
| `400` | Empty question | `{"error": "No question provided"}` |
| `400` | No document uploaded | `{"error": "Please upload a document first."}` |
| `500` | Unexpected exception | `{"error": "Error: <exception message>"}` |

**Notes:**
- Query is passed through `enhance_legal_query()` before vector search
- Retrieves top 6 chunks
- LLM is invoked with `QUESTION_ANSWER_PROMPT` template

---

## Source Object Schema

All analysis endpoints return a `sources` array. Each element:

```json
{
  "source_id": 1,          // Sequential integer within this response
  "page": 3,               // Primary page number of the chunk (1-indexed)
  "pages": [2, 3, 4],      // All pages this chunk spans (boundary expansion)
  "section": "Section 5.2 Termination",  // Detected section header, or "Unknown Section"
  "chunk_id": 17           // Sequential chunk identifier from processing
}
```

---

## What Does Not Exist

- No authentication on any endpoint
- No API key requirement
- No rate limiting
- No versioning (`/api/v1/` prefix, etc.)
- No `DELETE` or `GET` endpoints for documents
- No endpoint to list previously uploaded documents
- No webhook or async notification
- No CORS configuration
