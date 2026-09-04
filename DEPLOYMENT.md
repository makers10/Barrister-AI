# DEPLOYMENT.md — Barrister AI

## Current Deployment State

Barrister AI is running as a local development server on a Windows machine. There is no production deployment, no containerisation, no reverse proxy, and no cloud infrastructure.

---

## How It Is Currently Run

From the server log, the startup command used was:

```powershell
.\venv\Scripts\python.exe app.py 2> server_8080.log
```

The Flask development server starts and logs:

```
Barrister AI starting on port 8080...
WARNING: This is a development server. Do not use it in a production deployment.
 * Running on http://127.0.0.1:8080
```

The server is only accessible on `localhost` (`127.0.0.1`). It is not exposed to the network.

---

## Environment Configuration

All runtime configuration is in `.env` in the project root, loaded with `python-dotenv` at startup.

| Variable | Value in `.env` | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | API key for OpenRouter LLM service |
| `FLASK_SECRET_KEY` | `barrister-ai-secret-key-2024` | Flask session signing key |
| `FLASK_DEBUG` | `True` | Enables Flask debug mode |
| `FLASK_PORT` | `8080` | Port the server listens on |

---

## Python Environment

A virtual environment is used, located at `venv/` in the project root.

The startup command uses `.\venv\Scripts\python.exe` directly.

**Operating system:** Windows (confirmed by the Windows DLL path fix in `app.py` and the PowerShell error prefix in the log)

---

## Dependencies

Defined in `requirements.txt` with no version pinning:

```
flask
python-dotenv
PyPDF2
langchain
langchain-community
langchain-openai
langchain-text-splitters
faiss-cpu
sentence-transformers
transformers
torch
requests
werkzeug
```

Install with:

```bash
pip install -r requirements.txt
```

**Note from logs:** FAISS loads with AVX2 support (`faiss-cpu` with AVX2 detected automatically).

**Note from logs:** `HuggingFaceEmbeddings` triggers a `LangChainDeprecationWarning` — the class is deprecated in LangChain 0.2.2.

---

## Startup Behaviour

1. Windows DLL directories for PyTorch are added to the process path
2. `.env` is loaded
3. Flask app is created; `uploads/` directory is created if absent
4. Server starts on `0.0.0.0` or `127.0.0.1` (Flask default for `app.run()` without `host=` is `127.0.0.1`)
5. `use_reloader=False` is passed to `app.run()` — the auto-reloader is disabled
6. The embedding model is NOT loaded at startup — it loads lazily on the first PDF upload

---

## Static Assets

Served directly by Flask's built-in static file serving:

- `/static/css/style.css`
- `/static/js/script.js`

Two external resources are loaded from CDNs at page load time (require internet access in the browser):

- Font Awesome 6.4.0: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css`
- Google Fonts (Inter, Playfair Display): `https://fonts.googleapis.com/css2?...`

---

## File Storage

- Uploaded PDFs: `uploads/` directory in the project root (created at startup if absent)
- FAISS cache files: `*.pkl` files in the project root (created on first upload of each file)
- Log file: `server_8080.log` in the project root (written by shell redirection, not by the application itself)

---

## Process Management

No process manager (systemd, supervisor, PM2, etc.) is configured. If the process crashes or the machine restarts, the server does not auto-restart.

From the server log, the process was terminated by a `window-CLOSE event` (the console window was closed on Windows):

```
forrtl: error (200): program aborting due to window-CLOSE event
```

---

## What Does Not Exist

| Component | Status |
|---|---|
| Production WSGI server (Gunicorn, uWSGI) | Not configured |
| Reverse proxy (nginx, Caddy) | Not configured |
| HTTPS / TLS | Not configured |
| Docker / containerisation | No Dockerfile exists |
| Cloud deployment (Railway, Render, Heroku, etc.) | Not configured |
| CI/CD pipeline | Not configured |
| Health check endpoint | Does not exist |
| Process manager | Not configured |
| Log aggregation | Not configured |
| Domain name | Not configured |
