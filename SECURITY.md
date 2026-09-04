# SECURITY.md — Barrister AI

## Summary

Barrister AI in its current state has several significant security issues. This document records what actually exists in the code — no improvements are suggested here, only facts.

---

## Authentication & Authorization

**Status: None.**

There is no login system, no user accounts, no session authentication, and no access control on any endpoint. Any person who can reach the server can upload documents, run analyses, and consume LLM API quota.

---

## API Key Management

### OpenRouter API Key

**Location:** `.env` file in the project root

**Value in file:**
```
<!-- OPENROUTER_API_KEY=USER'S API key -->
git
```

The key is stored in plaintext in `.env`. The `.env` file is listed in `.gitignore`, which prevents it from being committed to Git. However:
- The file exists on disk in the project directory
- The business strategy document in this same repo explicitly flags: *"Your OpenRouter API key is exposed in the repo... Revoke and rotate it now."*

The key is read at runtime with `os.getenv("OPENROUTER_API_KEY")` and passed directly to the LangChain `ChatOpenAI` client.

### Flask Secret Key

**Location:** `.env` file

**Value in file:**
```
FLASK_SECRET_KEY=barrister-ai-secret-key-2024
```

This key signs Flask session cookies. It is a static, hardcoded string. If an attacker knows this key, they can forge valid session cookies.

If `FLASK_SECRET_KEY` is not set in the environment, the code falls back to `secrets.token_hex(16)`, which generates a new random key on every startup — invalidating all existing sessions.

---

## Input Validation

### File Upload

- Extension check: `file.filename.lower().endswith('.pdf')` — checks the string extension only, does not inspect file content or MIME type
- Filename sanitisation: `werkzeug.utils.secure_filename()` is used before saving to disk — prevents directory traversal attacks via filename
- File size: 200 MB limit enforced by Flask's `MAX_CONTENT_LENGTH`; requests exceeding this return a 413 error from Werkzeug

### Question Input (`/ask`)

- `.strip()` is applied and an empty string check is performed
- No length limit is enforced on the question string
- No sanitisation beyond stripping

---

## Rate Limiting

**Status: None.**

There is no rate limiting on any endpoint. Any client can send unlimited requests to `/upload`, `/analyze`, `/ask`, etc. This means:
- Unlimited LLM API calls consuming the OpenRouter quota
- Unlimited disk writes to `uploads/`
- Unlimited memory consumption in `document_store`

---

## CORS

No CORS headers are configured. The Flask app does not use `flask-cors` or set any `Access-Control-Allow-*` headers. Cross-origin requests are handled by Flask's default behaviour (no restriction, but no explicit header either).

---

## HTTPS / TLS

**Status: Not configured.**

The application runs on plain HTTP. No TLS termination is configured at the application level. The Flask development server does not support HTTPS. There is no reverse proxy (nginx, caddy, etc.) configured.

---

## Session Security

- Session data is stored in a **client-side signed cookie** (Flask default)
- The cookie contains: `session_id`, `current_pdf` (filepath), `current_filename`
- The cookie is signed but **not encrypted** — values are base64-encoded and readable by the client
- No `Secure`, `HttpOnly`, or `SameSite` flags are explicitly set on the session cookie (Flask defaults apply: `HttpOnly=True`, `Secure=False` in debug mode)

---

## Data Privacy

- Uploaded PDFs are saved permanently to the `uploads/` directory
- No file deletion occurs after processing
- No expiry or cleanup mechanism exists
- Users' document content is sent to the OpenRouter API (an external third-party service) for LLM inference

---

## License

**Current license:** MIT License (`LICENSE` file in the repo root)

The MIT license makes the entire codebase freely copyable, modifiable, and redistributable by anyone. The business strategy document in this repo flags this as a commercial risk.

---

## Debug Mode

`FLASK_DEBUG=True` is set in `.env`.

Running Flask in debug mode:
- Enables the Werkzeug interactive debugger on unhandled exceptions
- Enables the reloader (disabled separately with `use_reloader=False` in `app.run()`)
- The debugger exposes a PIN-protected console in the browser, but running in debug mode on a production-accessible server is a significant risk

The server log confirms: `WARNING: This is a development server. Do not use it in a production deployment.`

---

## Dependency Notes

No version pinning is used in `requirements.txt`. All dependencies are specified without version constraints (e.g., `flask`, `langchain`, `torch`). This means `pip install` will pull the latest version of each package, which may introduce breaking changes or vulnerabilities over time.

A `LangChainDeprecationWarning` is visible in the server logs for `HuggingFaceEmbeddings` — the class used is deprecated in LangChain 0.2.2.
