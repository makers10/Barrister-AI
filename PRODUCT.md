# PRODUCT.md — Barrister AI

## What It Is

Barrister AI is a web-based legal document analysis tool. Users upload a PDF document and receive AI-generated analysis covering summaries, key obligations, risk flags, and answers to specific legal questions about the document.

The product is built and run by a solo developer. As of the codebase state documented here, it is a working local prototype with no authentication, no payment system, and no persistent storage.

---

## Product Name

Two names appear in the codebase:
- **Barrister AI** — used in backend code, logs, module comments, and the business strategy document
- **Barrister Pro** — used in the HTML page title (`<title>Barrister Pro | Legal Intelligence</title>`) and the UI sidebar header

---

## What a User Can Do

After uploading a PDF, the user has access to five actions:

| Action | UI Label | API Endpoint | Description |
|---|---|---|---|
| Full Legal Audit | "Full Legal Audit" | `POST /analyze` | Comprehensive analysis: document type, summary, key points, supported rules, risky clauses, missing clauses, red flags, suggestions |
| Executive Summary | "Executive Summary" | `POST /summary` | Short and detailed summary with section-by-section breakdown |
| Risk Assessment | "Risk Assessment" | `POST /risks` | One-sided clauses, unlimited liability, ambiguous wording, missing protections, recommendations |
| Key Obligations | "Key Obligations" | `POST /keypoints` | Obligations, rights, payment terms, deadlines, penalties, conditions — each with page and section references |
| Ask a Question | Chat input | `POST /ask` | Natural language Q&A about the document; returns answer with source page and section |

---

## Document Types the System Recognizes

Detected automatically from document text. The system checks for keyword matches and flags a document type if at least 2 keywords match:

- Employment Agreement
- Non-Disclosure Agreement
- Service Agreement
- Lease Agreement
- Sales Contract
- Partnership Agreement
- Loan Agreement
- License Agreement
- Terms of Service
- Privacy Policy
- Merger Agreement
- Insurance Policy

---

## What Is Shown After Upload

After a successful upload, the UI displays:
- Document filename (in a pill badge in the top nav)
- Total pages
- Identified sections count
- Character count

---

## Language Support

English only. No multilingual support exists in the codebase.

---

## File Size Limit

200 MB (`MAX_CONTENT_LENGTH = 200 * 1024 * 1024` in `app.py`).

---

## File Types Accepted

PDF only. The upload handler explicitly rejects files that do not end in `.pdf`.

---

## Current Status

- No user accounts
- No payment system
- No database
- No rate limiting
- Running on Flask development server (not production-grade)
- API key for the LLM (OpenRouter) is stored in a local `.env` file
- Session data is stored in a Python in-memory dictionary — lost on every server restart
