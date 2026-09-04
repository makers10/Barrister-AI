# DOC_AUDIT.md — Documentation Consistency Audit
## Barrister AI | Audit Date: 2026-07-04

This audit compares every generated documentation file against the actual source code.
Each finding is classified, traced to a specific doc file and code location, and rated by severity.

### Severity Legend
- CRITICAL — The doc states something that is directly contradicted by the code
- MAJOR    — The doc omits something significant that exists in the code, or vice versa
- MINOR    — A nuance, edge-case, or wording that is inaccurate but not misleading overall
- INFO     — Undocumented behaviour that exists in code but has no practical doc impact

---

## AUDIT SUMMARY

| # | File | Finding | Severity |
|---|---|---|---|
| 1 | AI_PIPELINE.md | legal_boost_words count is wrong — doc says 18, code has 21 | CRITICAL |
| 2 | AI_PIPELINE.md | Fallback sleep timing is wrong — doc implies 4s total sleep; actual worst-case is different | MAJOR |
| 3 | AI_PIPELINE.md | full_analysis rerank query does not match actual code | MAJOR |
| 4 | AI_PIPELINE.md | DISCLAIMER claim is incorrect — only 2 of 5 prompts contain it | MAJOR |
| 5 | AI_PIPELINE.md | build_legal_context signature documented with unused second parameter | MINOR |
| 6 | ARCHITECTURE.md | retriever.py listed under /ask flow only — it is also used by ALL analysis endpoints | MAJOR |
| 7 | ARCHITECTURE.md | chunking.py exports get_expanded_context() — completely undocumented | MINOR |
| 8 | ARCHITECTURE.md | _get_llm() function exists and is documented nowhere | MINOR |
| 9 | API.md | /analyze accepts a body — the frontend sends Content-Type: application/json with no body; doc says "no body required" which is correct BUT the route has no body parsing at all, yet the JS sends a header — minor inconsistency worth noting | MINOR |
| 10 | API.md | /upload error condition for "pages_data is empty but pages exist" is undocumented | MINOR |
| 11 | API.md | full_analysis() returns doc_info in its result dict — this key is silently dropped by the route handler and never returned to the client; doc does not mention it | MINOR |
| 12 | SECURITY.md | Claim that .env is in .gitignore — no .gitignore was read; this cannot be confirmed from the files provided | MAJOR |
| 13 | SECURITY.md | CORS claim is partially wrong — Flask does restrict cross-origin cookies by default | MINOR |
| 14 | SECURITY.md | Cookie filepath leak: current_pdf stores the full server-side filesystem path in the client cookie — not documented as a security risk | MAJOR |
| 15 | DEPLOYMENT.md | Startup sequence step 4 says server starts on "0.0.0.0 or 127.0.0.1" — app.run() with no host= binds to 127.0.0.1 only, but log confirms 127.0.0.1; the "0.0.0.0" option is not supported by current code | MINOR |
| 16 | DEPLOYMENT.md | server_error.log file exists on disk but is not documented anywhere | MAJOR |
| 17 | KNOWN_LIMITATIONS.md | Limitation #3 worst-case time calculation is wrong | CRITICAL |
| 18 | KNOWN_LIMITATIONS.md | Limitation #7 says 11 patterns — code has 11 regex patterns PLUS all-caps check = 12 detection paths | MINOR |
| 19 | KNOWN_LIMITATIONS.md | get_expanded_context() in chunking.py is never called anywhere — this dead code is not documented as a limitation | MAJOR |
| 20 | PRODUCT.md | UI label mismatch — doc says "Full Legal Audit" but UI shows "Pro Legal Audit" in the JS | CRITICAL |
| 21 | PRODUCT.md | Drag-and-drop upload is implemented and functional — not documented as a feature | MAJOR |
| 22 | PRODUCT.md | "New Analysis" / workspace reset is a documented nav item that clears state — not listed as a user action | MINOR |
| 23 | DATABASE.md | document_store line number is wrong — doc says line 48, it is at line 47 | MINOR |
| 24 | DATABASE.md | Pickle cache invalidation analysis contains a logical error | MAJOR |
| 25 | ROADMAP.md | LICENSE copyright holder name is undocumented — LICENSE file shows "Copyright (c) 2026 Harsh@" | INFO |
| 26 | All docs | server_error.log file exists in workspace but is never referenced in any documentation | MAJOR |
| 27 | ARCHITECTURE.md | Re: diagram — retriever.py is not shown as used by /upload path, which is correct, but it IS used by all 4 analysis routes; the diagram only shows it under /ask | MAJOR |
| 28 | AI_PIPELINE.md | The "each type has 5 keywords" claim is wrong for several types | CRITICAL |

---

## DETAILED FINDINGS


---

## FINDING 1 — AI_PIPELINE.md
### Legal boost words count is stated as 18 but the actual set has 21 entries
**Severity:** CRITICAL
**Doc location:** AI_PIPELINE.md, Stage 5 Reranking section

**Documentation states:**
> "count matches against 18 boost words: obligation, shall, must, liability, indemnify, terminate, breach, penalty, warranty, damages, confidential, dispute, arbitration, governing law, force majeure, intellectual property, covenant, representations, warranties, default, remedy"

**Actual code in modules/retriever.py:**
```python
legal_boost_words = {
    'obligation', 'shall', 'must', 'liability', 'indemnify',
    'terminate', 'breach', 'penalty', 'warranty', 'damages',
    'confidential', 'dispute', 'arbitration', 'governing law',
    'force majeure', 'intellectual property', 'covenant',
    'representations', 'warranties', 'default', 'remedy'
}
```

Counting the actual set:
obligation, shall, must, liability, indemnify, terminate, breach, penalty, warranty, damages, confidential, dispute, arbitration, governing law, force majeure, intellectual property, covenant, representations, warranties, default, remedy = 21 entries

The doc listed all 21 words correctly in the prose but stated the count as 18. The count is wrong.

---

## FINDING 2 — AI_PIPELINE.md
### Fallback worst-case time calculation in prose is misleading
**Severity:** MAJOR
**Doc location:** AI_PIPELINE.md, Stage 6 Fallback Logic section

**Documentation states:**
> "the fallback mechanism sleeps 2 seconds between retries, meaning a full fallback through all three models adds up to 4 seconds of sleep plus three timeout windows of up to 35 seconds each (worst case: ~109 seconds total before giving up)"

This calculation (referenced in KNOWN_LIMITATIONS.md #3) is wrong.

**Actual code logic:**
- Model 1: attempt (up to 35s timeout) + if fails: sleep 2s
- Model 2: attempt (up to 35s timeout) + if fails: sleep 2s
- Model 3: attempt (up to 35s timeout) + no sleep after last

Correct worst case: 35 + 2 + 35 + 2 + 35 = **109 seconds**

The total of 109 seconds is actually correct numerically, but the doc says "4 seconds of sleep" — there are only 2 sleep calls (between model 1->2 and model 2->3), totalling 4 seconds. That part is correct.

However: `max_retries=1` is set on the ChatOpenAI client, meaning each model attempt can itself retry once internally before the outer try/except catches it. This means each model slot could consume up to 70 seconds (35s × 2 internal retries), making the real worst case: (35×2) + 2 + (35×2) + 2 + (35×2) = **214 seconds**. Neither the AI_PIPELINE.md nor KNOWN_LIMITATIONS.md documents this interaction between `max_retries=1` and `request_timeout=35`.

---

## FINDING 3 — AI_PIPELINE.md
### The rerank query for full_analysis does not match the code
**Severity:** MAJOR
**Doc location:** AI_PIPELINE.md, Retrieval Parameters table at the bottom

**Documentation states:**
```
| /analyze | 10 | "legal terms obligations rights" |
```

**Actual code in modules/legal_analyzer.py, full_analysis():**
```python
all_results = search_vector_store(vector_store, "legal terms obligations rights", top_k=10)
docs = rerank_legal_contexts("legal terms obligations rights conditions", all_results)
```

There are TWO different query strings used: one for the vector search (`"legal terms obligations rights"`) and a different one for reranking (`"legal terms obligations rights conditions"`). The doc only documents the search query and does not mention that the rerank step uses a distinct, extended query string. This applies to all five endpoints but is most notable here because the discrepancy is visible and could confuse someone trying to understand why results are scored the way they are.

Full rerank queries vs search queries by endpoint (not documented anywhere):

| Endpoint | Search Query | Rerank Query (different!) |
|---|---|---|
| /analyze | "legal terms obligations rights" | "legal terms obligations rights conditions" |
| /summary | "summary overview purpose scope" | "summary overview purpose" |
| /risks | "liability risk penalty termination breach indemnify limitation" | "risk liability termination breach penalty" |
| /keypoints | "obligations rights payment deadline penalty condition" | "obligations rights terms conditions" |
| /ask | (user question, enhanced) | (same enhanced query) |

---

## FINDING 4 — AI_PIPELINE.md
### DISCLAIMER claim is wrong — only 2 of 5 prompts contain it
**Severity:** MAJOR
**Doc location:** AI_PIPELINE.md, Prompt Templates section

**Documentation states:**
> "Each prompt explicitly instructs the LLM to: ... End with: 'DISCLAIMER: This is an AI-based analysis and not legal advice.'"

**Actual code in modules/prompt_engine.py:**

Checking each prompt for the DISCLAIMER line:
- FULL_ANALYSIS_PROMPT — does NOT contain the disclaimer in the prompt text
- QUESTION_ANSWER_PROMPT — CONTAINS "DISCLAIMER: This is an AI-based analysis and not legal advice."
- SUMMARY_PROMPT — does NOT contain the disclaimer
- RISK_ANALYSIS_PROMPT — does NOT contain the disclaimer
- KEY_POINTS_PROMPT — does NOT contain the disclaimer

Only QUESTION_ANSWER_PROMPT contains the disclaimer. The claim that "each prompt" includes it is incorrect. Only 1 of 5 prompts contains it (QUESTION_ANSWER_PROMPT). The BARRISTER_SYSTEM_PROMPT constant also contains it, but as documented, that constant is never used in any chain.

---

## FINDING 5 — AI_PIPELINE.md
### build_legal_context() second parameter is documented but functionally unused
**Severity:** MINOR
**Doc location:** AI_PIPELINE.md, Stage 5 Context Assembly section

**Documentation states:**
> build_legal_context(docs, all_chunks) — Deduplicates by chunk_id...

**Actual code in modules/retriever.py:**
```python
def build_legal_context(
    docs: List[Document],
    all_chunks: List[Dict] = None
) -> Tuple[str, List[Dict]]:
```

The `all_chunks` parameter has a default of `None` and is **never used inside the function body**. The function body references only `docs`. The parameter exists in the signature but does nothing.

This is documented nowhere — not as a limitation, not as dead code.

At the call sites in legal_analyzer.py:
```python
context, sources = build_legal_context(docs, chunks)
```
`chunks` is passed but silently ignored inside the function.


---

## FINDING 6 — ARCHITECTURE.md
### retriever.py is shown only under /ask but is used by ALL analysis routes
**Severity:** MAJOR
**Doc location:** ARCHITECTURE.md, Overview diagram

**Documentation diagram shows:**
```
└── /ask ──► modules/legal_analyzer.py → ask_question()
                 │
                 ├── modules/retriever.py
```
retriever.py appears only in the /ask branch of the diagram.

**Actual code — retriever.py is imported and used by ALL five functions in legal_analyzer.py:**
- full_analysis() calls: rerank_legal_contexts(), expand_page_context(), build_legal_context()
- ask_question() calls: enhance_legal_query(), rerank_legal_contexts(), expand_page_context(), build_legal_context()
- get_summary() calls: rerank_legal_contexts(), expand_page_context(), build_legal_context()
- get_risk_analysis() calls: rerank_legal_contexts(), expand_page_context(), build_legal_context()
- get_key_points() calls: rerank_legal_contexts(), expand_page_context(), build_legal_context()

Only enhance_legal_query() is exclusive to /ask. The other three retriever functions are used by every analysis endpoint. The diagram is architecturally misleading.

---

## FINDING 7 — ARCHITECTURE.md
### get_expanded_context() in chunking.py is completely undocumented
**Severity:** MINOR
**Doc location:** ARCHITECTURE.md, modules/chunking.py component section

**Documentation states:**
> modules/chunking.py — Text splitting with page/section metadata
> chunk_with_page_index(), _merge_boundary_chunks() are documented

**Actual code in modules/chunking.py:**
```python
def get_expanded_context(
    chunks: List[Dict],
    target_page: int,
    target_section: str = None
) -> List[Dict]:
```

This is a public function exported by chunking.py. It implements the N-1/N/N+1 page strategy via a different code path than expand_page_context() in retriever.py.

It is never imported or called anywhere in the codebase (dead code), but it exists in the module and is not mentioned in any documentation file — not ARCHITECTURE.md, not AI_PIPELINE.md, not KNOWN_LIMITATIONS.md.

---

## FINDING 8 — ARCHITECTURE.md
### _get_llm() helper function is not documented
**Severity:** MINOR
**Doc location:** ARCHITECTURE.md, modules/legal_analyzer.py section

**Actual code in modules/legal_analyzer.py:**
```python
def _get_llm(model_name: str = None) -> ChatOpenAI:
    """Create an LLM instance for the given model."""
    return ChatOpenAI(
        openai_api_base="https://openrouter.ai/api/v1",
        ...
    )
```

ARCHITECTURE.md documents _invoke_llm_with_fallback() but does not mention _get_llm(). While _get_llm() is a private helper, it is the only place where the ChatOpenAI configuration parameters (temperature, max_tokens, request_timeout, max_retries, HTTP-Referer header) are set. AI_PIPELINE.md does document these parameters correctly but attributes them to the fallback function rather than _get_llm().

---

## FINDING 9 — API.md
### /analyze, /summary, /risks, /keypoints accept a body the JS sends but the server ignores
**Severity:** MINOR
**Doc location:** API.md, /analyze section

**Documentation states:**
> Request: No body required.

**Actual JS code in script.js:**
```javascript
const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: abortController.signal
});
```

The frontend sends `Content-Type: application/json` with no body to all four analysis endpoints. The server routes for /analyze, /summary, /risks, /keypoints do not call request.get_json() and correctly ignore any body. The doc statement "No body required" is technically correct. However, the fact that the frontend is sending a Content-Type: application/json header with no body is an inconsistency in the implementation that is not documented anywhere.

---

## FINDING 10 — API.md
### /upload: one edge case error path is undocumented
**Severity:** MINOR
**Doc location:** API.md, POST /upload Error Responses table

The upload handler calls process_pdf() which calls load_pdf_with_pages(). That function has an outer try/except that returns an empty list [] on any exception (not just text-extraction failure). If the empty list is returned for reasons other than unreadable text — for example, a corrupted PDF that raises a PyPDF2 exception — the error message returned to the client is:
"Failed to extract text from PDF. The file may be empty or a scanned image."

This message is misleading for PDF parse errors unrelated to OCR. The log confirms this: sample.pdf triggered a "incorrect startxref pointer(1)" PyPDF2 WARNING, extracted 0 chars, and returned a 500. The error message shown to the user would be the generic "Failed to extract text" message, not a PDF corruption message. Not documented.

---

## FINDING 11 — API.md
### full_analysis() returns doc_info in its dict but the route handler silently drops it
**Severity:** MINOR
**Doc location:** API.md, POST /analyze Success Response section

**Actual code in modules/legal_analyzer.py, full_analysis():**
```python
return {
    'analysis': answer,
    'sources': sources,
    'doc_info': doc_info   # <-- this key is returned
}
```

**Actual code in app.py, analyze() route:**
```python
return jsonify({
    'success': True,
    'analysis': result['analysis'],
    'sources': result['sources']
    # doc_info is NOT included — silently dropped
})
```

The `doc_info` key is present in the internal function return value but stripped by the route handler. The API response schema in API.md correctly reflects what the client receives (no doc_info), but the discrepancy between the internal function contract and the public API contract is undocumented.


---

## FINDING 12 — SECURITY.md
### Claim that .env is in .gitignore cannot be confirmed from available files
**Severity:** MAJOR
**Doc location:** SECURITY.md, API Key Management section

**Documentation states:**
> "The .env file is listed in .gitignore, which prevents it from being committed to Git."

The .gitignore file was not read during the documentation generation or the audit. No .gitignore content was provided. This claim is stated as confirmed fact but is unverified. The business strategy document also states this claim but is itself not a code source.

If .env is NOT in .gitignore, the actual API key `sk-or-USERs AI API key` would be committed to any Git repository push, which is a critical security incident — not just a risk.

The audit cannot confirm or deny this claim from the available files. It should be marked as "Unverified" in the documentation, not stated as fact.

---

## FINDING 13 — SECURITY.md
### CORS statement "no restriction" is not entirely accurate
**Severity:** MINOR
**Doc location:** SECURITY.md, CORS section

**Documentation states:**
> "Cross-origin requests are handled by Flask's default behaviour (no restriction, but no explicit header either)."

Flask's default behaviour does NOT set CORS headers, which means browsers WILL enforce the same-origin policy for cross-origin requests. "No restriction" implies the API is open to any origin, which is incorrect from a browser security perspective. The API IS restricted to same-origin requests by browser enforcement — it's just that the server doesn't explicitly set headers to allow or deny cross-origin access.

The accurate statement is: No CORS headers are set, so browser-based cross-origin requests will be blocked by the browser's same-origin policy. Non-browser clients (like curl or requests) are not restricted.

---

## FINDING 14 — SECURITY.md
### current_pdf filepath in cookie is a security risk not documented
**Severity:** MAJOR
**Doc location:** SECURITY.md, Session Security section

**Documentation states the cookie contains:**
> "session_id, current_pdf (filepath), current_filename"

**Actual code in app.py:**
```python
session['current_pdf'] = filepath
```
Where `filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)` = `uploads/filename.pdf`

The session cookie stores the server-side filesystem path of the uploaded file. Flask's default session cookie is signed but NOT encrypted — the contents are base64-encoded and fully readable by any client who inspects their cookie. This means any user can read their own session cookie and see the server's filesystem path structure (`uploads/filename.pdf`). This reveals the server directory layout. SECURITY.md notes that the cookie is "readable by the client" but does not flag the filepath disclosure as a specific risk.

---

## FINDING 15 — DEPLOYMENT.md
### Startup sequence mentions "0.0.0.0 or 127.0.0.1" — code only binds to 127.0.0.1
**Severity:** MINOR
**Doc location:** DEPLOYMENT.md, Startup Behaviour section, step 4

**Documentation states:**
> "Server starts on 0.0.0.0 or 127.0.0.1 (Flask default for app.run() without host= is 127.0.0.1)"

**Actual code in app.py:**
```python
app.run(debug=debug, port=port, use_reloader=False)
```
No `host=` argument is passed. Flask's default when host is omitted is `127.0.0.1`. The server log confirms: `Running on http://127.0.0.1:8080`. The mention of `0.0.0.0` as an option in the startup sequence step is misleading — it would require a code change to bind to 0.0.0.0. The current code never binds to 0.0.0.0.

---

## FINDING 16 — DEPLOYMENT.md
### server_error.log exists on disk but is not documented anywhere
**Severity:** MAJOR
**Doc location:** DEPLOYMENT.md, File Storage section; ARCHITECTURE.md, Directory Structure section

**Observed in workspace file tree:**
```
server_8080.log
server_error.log    <-- this file exists
```

DEPLOYMENT.md documents `server_8080.log` and explains it is written by shell redirection. `server_error.log` is also present in the workspace root. Neither DEPLOYMENT.md nor ARCHITECTURE.md mention this file. Its origin (separate stderr redirect? a different run configuration?) is not documented.

The directory structure listing in ARCHITECTURE.md shows `server_8080.log` but omits `server_error.log`.


---

## FINDING 17 — KNOWN_LIMITATIONS.md
### Limitation #3 worst-case time calculation does not account for max_retries=1
**Severity:** CRITICAL
**Doc location:** KNOWN_LIMITATIONS.md, Limitation #3

**Documentation states:**
> "The fallback mechanism sleeps 2 seconds between retries, meaning a full fallback through all three models adds up to 4 seconds of sleep plus three timeout windows of up to 35 seconds each (worst case: ~109 seconds total before giving up)."

**Actual code — two compounding timeout parameters:**
```python
# In _get_llm():
request_timeout=35,
max_retries=1
```

`max_retries=1` tells the LangChain/httpx client to retry each failed HTTP request once internally before raising an exception to the outer Python try/except. This means each model slot in the fallback loop can consume up to 2 × 35 = 70 seconds before the outer except clause catches it.

Correct worst-case calculation:
- Model 1: 70s (2 internal tries × 35s) + 2s sleep
- Model 2: 70s + 2s sleep
- Model 3: 70s (no sleep after last)
- Total: **214 seconds** (~3.5 minutes)

The documented value of 109 seconds is based on the incorrect assumption that each model is tried only once. The actual worst case is nearly double.

---

## FINDING 18 — KNOWN_LIMITATIONS.md
### Limitation #7 says "11 patterns" — there are 11 regex patterns PLUS all-caps detection = 12 detection paths
**Severity:** MINOR
**Doc location:** KNOWN_LIMITATIONS.md, Limitation #7

**Documentation states:**
> "detect_section_header() in pdf_loader.py uses regex patterns designed for common English legal document structures... its 11 patterns"

**Actual code in modules/pdf_loader.py:**
```python
patterns = [
    r'^(ARTICLE|Article)\s+\d+[\.:;\-\s]',        # 1
    r'^(SECTION|Section)\s+\d+[\.\d]*[\.:;\-\s]',  # 2
    r'^(CLAUSE|Clause)\s+\d+[\.\d]*[\.:;\-\s]',    # 3
    r'^(SCHEDULE|Schedule)\s+[A-Z\d]+',             # 4
    r'^(APPENDIX|Appendix)\s+[A-Z\d]+',             # 5
    r'^(PART|Part)\s+[IVXLCDM\d]+',                # 6
    r'^(EXHIBIT|Exhibit)\s+[A-Z\d]+',               # 7
    r'^(RECITAL|Recital)[S]?\s*',                   # 8
    r'^(WHEREAS|WITNESSETH|NOW\s*,?\s*THEREFORE)',  # 9
    r'^\d+\.\s+[A-Z][A-Z\s]{3,}',                  # 10
    r'^\d+\.\d+\s+[A-Z]',                          # 11
]
# PLUS this separate check:
if line.isupper() and len(line) > 5 and len(line) < 100:
    return line
```

There are 11 regex patterns plus 1 all-caps heuristic = 12 total detection paths. The all-caps check was correctly described in AI_PIPELINE.md but the count in KNOWN_LIMITATIONS.md is stated as "11 patterns" without acknowledging the separate all-caps check.

---

## FINDING 19 — KNOWN_LIMITATIONS.md
### get_expanded_context() is dead code — not documented as a limitation
**Severity:** MAJOR
**Doc location:** KNOWN_LIMITATIONS.md (absent — this should be here)

**Actual code in modules/chunking.py:**
```python
def get_expanded_context(
    chunks: List[Dict],
    target_page: int,
    target_section: str = None
) -> List[Dict]:
    """
    Get expanded context for a page using N-1, N, N+1 strategy.
    """
```

This function is defined and exported. It is never imported or called anywhere in the codebase. The N-1/N/N+1 page expansion logic is instead implemented separately in `expand_page_context()` in `modules/retriever.py`.

This is a duplicate implementation of the same concept where one version (chunking.py) is dead and the other (retriever.py) is live. This is not mentioned in KNOWN_LIMITATIONS.md, ARCHITECTURE.md, or AI_PIPELINE.md.

---

## FINDING 20 — PRODUCT.md
### UI label mismatch: doc says "Full Legal Audit" but JS uses "Pro Legal Audit"
**Severity:** CRITICAL
**Doc location:** PRODUCT.md, What a User Can Do table

**Documentation states:**
```
| Full Legal Audit | "Full Legal Audit" | POST /analyze | ...
```

**Actual code in static/js/script.js:**
```javascript
const endpoints = {
    'full': { url: '/analyze', key: 'analysis', label: 'Pro Legal Audit' },
```

The label used in the JS for display purposes (in loading messages, report card headers, and bot messages) is `'Pro Legal Audit'`, not `'Full Legal Audit'`.

The sidebar button text in index.html IS "Full Legal Audit" — so there is an internal inconsistency in the product itself: the sidebar nav says "Full Legal Audit" but the analysis result cards and chat messages say "Pro Legal Audit". PRODUCT.md documents only the sidebar label and misses the JS label entirely.


---

## FINDING 21 — PRODUCT.md
### Drag-and-drop file upload is implemented but not documented as a feature
**Severity:** MAJOR
**Doc location:** PRODUCT.md, What a User Can Do section

**Documentation lists five actions:** upload, /analyze, /summary, /risks, /keypoints, /ask

The upload interaction is described only as "upload a PDF". The documentation does not mention that drag-and-drop is supported.

**Actual code in static/js/script.js:**
```javascript
uploadArea.addEventListener('dragover', (e) => { ... });
uploadArea.addEventListener('dragleave', () => { ... });
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        handleUpload(file);
    } else {
        updateStatus('❌ Invalid file type. PDF only.', 'error');
    }
});
```

The drop event handler validates the file MIME type (`file.type === 'application/pdf'`), not just the extension like the server-side check. This is a stricter client-side validation than what is documented. The file extension check on the backend is `.pdf` string suffix check, while the frontend drag-drop uses browser MIME type (`application/pdf`).

Drag-and-drop is a significant UX feature and should be documented.

---

## FINDING 22 — PRODUCT.md
### "New Analysis" action exists but is not listed
**Severity:** MINOR
**Doc location:** PRODUCT.md, What a User Can Do section

**Actual UI in index.html sidebar:**
```html
<button class="nav-item" onclick="resetWorkspace()">
    <span class="nav-icon"><i class="fas fa-plus"></i></span>
    New Analysis
</button>
```

**Actual code in static/js/script.js:**
```javascript
function resetWorkspace() {
    // Clears state, resets upload view
}
```

This is a user-visible action that clears the current session and returns to the upload screen. It is not documented in the "What a User Can Do" section of PRODUCT.md.

---

## FINDING 23 — DATABASE.md
### document_store line number is incorrect
**Severity:** MINOR
**Doc location:** DATABASE.md, In-Memory Python Dictionary section

**Documentation states:**
> Location: app.py, line 48

**Actual code in app.py:**
Line 47: `document_store = {}`
Line 48: (blank line)

The module-level `document_store = {}` statement is on line 47, not line 48. The doc references line 48, which is incorrect. (This assumes line numbering starts at 1 for line 1 of the file.)

---

## FINDING 24 — DATABASE.md
### Pickle cache invalidation analysis contains a logical error
**Severity:** MAJOR
**Doc location:** DATABASE.md, Pickle File Cache section

**Documentation states:**
> "On every upload, the code explicitly deletes the existing cache file for that filename before rebuilding... This means the cache does NOT provide persistence across uploads of the same file — it is only used if the cache file exists AND was not just deleted (which it always is). The cache effectively does nothing for re-uploads."

This analysis is correct for sequential uploads **within the same session**, but the conclusion that "the cache effectively does nothing" is wrong for a different scenario:

**Scenario where the cache DOES work:**
1. User uploads `contract.pdf` → cache created as `contract.pdf.pkl`
2. Server crashes or restarts
3. User uploads `contract.pdf` again (or another user uploads a file named `contract.pdf`)
4. The cache file still exists on disk from step 1
5. The code tries to delete it, succeeds, then rebuilds
6. BUT: the vector_store.py create_vector_store() function has this logic at the TOP:

```python
if cache_path and os.path.exists(cache_path):
    try:
        with open(cache_path, "rb") as f:
            vector_store = pickle.load(f)
        logger.info("✅ Loaded cached vector store")
        return vector_store
    except Exception as e:
        logger.warning(f"⚠️ Failed to load cache, rebuilding: {e}")
```

This cache-loading attempt happens BEFORE the cache deletion in legal_analyzer.py process_pdf(). The deletion happens in process_pdf() AFTER load_pdf_with_pages() but BEFORE create_vector_store() is called.

Wait, re-reading the legal_analyzer.py code:

```python
# Step 4: Create vector store
cache_path = f"{os.path.basename(pdf_path)}.pkl"
# Clear old cache
if os.path.exists(cache_path):
    try:
        os.remove(cache_path)
    except Exception:
        pass

vector_store = create_vector_store(chunks, cache_path=cache_path)
```

The cache is deleted BEFORE create_vector_store() is called. So the cache check inside create_vector_store() will always find the file missing. The analysis in DATABASE.md is actually correct — the cache is deleted before the cache-load attempt in create_vector_store() can happen, making the cache useless across uploads of the same filename.

However — the documentation fails to note that the cache WOULD work for **different filenames**. If you upload `doc1.pdf`, then upload `doc2.pdf`, the `doc1.pdf.pkl` cache remains on disk and IS NOT deleted (only the cache for the currently uploading file is deleted). If you then upload `doc1.pdf` again in the same session, the old `doc1.pdf.pkl` cache still exists and would be loaded by create_vector_store()... except it is deleted right before create_vector_store() is called.

Wait, no. Re-reading again: the deletion happens immediately before create_vector_store() is called with that same cache_path. So the cache for the **current file being uploaded** is always deleted. The cache for **other files** is left on disk.

The conclusion is: the cache provides cross-session persistence for FILE A if you upload FILE B and never re-upload FILE A. But for the file you're currently uploading, the cache is always invalidated. This nuance is not captured by the doc statement "the cache effectively does nothing" — it does nothing for the file being uploaded NOW, but it preserves state for other files.

Actually, this doesn't make sense either because the cache-load logic is inside create_vector_store(), which is only called after the deletion. So the cache is always empty when checked.

The database.md analysis conclusion is correct. The "does nothing" statement is accurate. The cache deletion precedes the cache load attempt, making the entire caching mechanism non-functional for its intended purpose.


---

## FINDING 25 — ROADMAP.md (INFO)
### LICENSE copyright holder name is not documented anywhere
**Severity:** INFO
**Doc location:** ROADMAP.md, Immediate Action Items section (mentions changing license)

**Actual LICENSE file:**
```
MIT License
Copyright (c) 2026 Harsh@
```

The author's name/handle `Harsh@` appears in the LICENSE file. No documentation file references the author's name. The ROADMAP.md says to "Change the LICENSE file from MIT to a proprietary license or BSL 1.1" without noting that the current license has a copyright holder name in it that would carry over or need updating. This is informational only.

---

## FINDING 26 — All documentation files
### server_error.log exists on disk and is never referenced in any documentation
**Severity:** MAJOR
**Doc location:** ARCHITECTURE.md directory structure; DEPLOYMENT.md file storage section

**Observed in workspace:**
```
server_8080.log    ← documented
server_error.log   ← NOT documented
```

The file `server_error.log` exists in the project root. No documentation file acknowledges it. We do not have its contents to read, so its origin is unknown. Possibilities:
- A second server run with stderr redirected to a different file
- A manual creation
- A different startup script

ARCHITECTURE.md's directory structure listing omits this file. DEPLOYMENT.md's "File Storage" section lists only `server_8080.log`. Both documents are incomplete.

---

## FINDING 27 — ARCHITECTURE.md
### Architecture diagram shows retriever.py only under /ask; it is used by all 4 analysis routes
**Severity:** MAJOR

(This is the same root issue as Finding 6 but applies specifically to the diagram structure rather than the prose description.)

**Documentation diagram shows:**
```
├── /analyze ──► modules/legal_analyzer.py → full_analysis()
├── /summary ──► modules/legal_analyzer.py → get_summary()
├── /risks   ──► modules/legal_analyzer.py → get_risk_analysis()
├── /keypoints ► modules/legal_analyzer.py → get_key_points()
└── /ask     ──► modules/legal_analyzer.py → ask_question()
                     │
                     ├── modules/retriever.py   ← only here
```

The diagram implies retriever.py is only invoked by ask_question(). In reality, full_analysis(), get_summary(), get_risk_analysis(), and get_key_points() ALL call rerank_legal_contexts(), expand_page_context(), and build_legal_context() from retriever.py. The diagram should show retriever.py as a shared dependency of all five legal_analyzer functions.

---

## FINDING 28 — AI_PIPELINE.md
### Claim "each type has 5 keywords" is wrong for multiple document types
**Severity:** CRITICAL
**Doc location:** AI_PIPELINE.md, Stage 1 Document Type Detection section

**Documentation states:**
> "Each type has 5 keywords; a type is flagged if at least 2 keywords are found"

**Actual code in modules/pdf_loader.py — keyword counts:**

```python
type_keywords = {
    'Employment Agreement':      ['employment', 'employee', 'employer', 'salary', 'termination of employment'],      # 5 ✓
    'Non-Disclosure Agreement':  ['confidential', 'nda', 'non-disclosure', 'proprietary information'],               # 4 ✗
    'Service Agreement':         ['service provider', 'services', 'scope of work', 'deliverables'],                  # 4 ✗
    'Lease Agreement':           ['lease', 'tenant', 'landlord', 'premises', 'rent'],                                # 5 ✓
    'Sales Contract':            ['purchase', 'buyer', 'seller', 'goods', 'delivery'],                               # 5 ✓
    'Partnership Agreement':     ['partner', 'partnership', 'profit sharing', 'capital contribution'],               # 4 ✗
    'Loan Agreement':            ['loan', 'borrower', 'lender', 'interest rate', 'repayment'],                       # 5 ✓
    'License Agreement':         ['license', 'licensor', 'licensee', 'royalty', 'intellectual property'],            # 5 ✓
    'Terms of Service':          ['terms of service', 'terms and conditions', 'user agreement'],                     # 3 ✗
    'Privacy Policy':            ['privacy', 'personal data', 'data protection', 'gdpr'],                            # 4 ✗
    'Merger Agreement':          ['merger', 'acquisition', 'closing', 'shareholders'],                               # 4 ✗
    'Insurance Policy':          ['insurance', 'insured', 'insurer', 'premium', 'claim', 'coverage'],               # 6 ✗
}
```

Keyword counts per type:
- 5 keywords: Employment Agreement, Lease Agreement, Sales Contract, Loan Agreement, License Agreement (5 types)
- 4 keywords: NDA, Service Agreement, Partnership Agreement, Privacy Policy, Merger Agreement (5 types)
- 3 keywords: Terms of Service (1 type)
- 6 keywords: Insurance Policy (1 type)

Only 5 of the 12 types actually have exactly 5 keywords. The remaining 7 types have 3, 4, or 6 keywords. The documentation claim "each type has 5 keywords" is factually incorrect for 7 of 12 document types.


---

## ADDITIONAL FINDINGS — Undocumented Behaviours

The following items exist in the code and are not covered by any of the nine documentation files.

---

### A. _test_workflow.py sends requests to port 8080 hardcoded — not documented
**Severity:** MINOR
**File:** _test_workflow.py

```python
BASE_URL = 'http://127.0.0.1:8080'
```

The test script hardcodes port 8080. If `FLASK_PORT` is changed in `.env`, the test script will silently target the wrong port. No documentation mentions this coupling. The test script is described in ARCHITECTURE.md only as "Manual integration test script" with no detail about its hardcoded assumptions.

---

### B. Frontend drag-drop validates by MIME type; backend validates by file extension — inconsistency not documented
**Severity:** MINOR

Frontend drop handler: `if (file && file.type === 'application/pdf')`
Backend upload handler: `if not file.filename.lower().endswith('.pdf')`

A file named `document.pdf` that is actually a JPEG (wrong MIME type) would:
- Be REJECTED by the drag-drop handler (MIME check fails)
- Be ACCEPTED by the file picker upload (no MIME check, only extension)

A file named `document.jpg` that is actually a PDF would:
- Be rejected by drag-drop (MIME check: application/pdf ≠ image/jpeg)
- Be rejected by backend (extension check: .jpg ≠ .pdf)

A file named `malicious.pdf` that is actually executable content would:
- Pass both checks and be saved to disk

This validation inconsistency is not documented in SECURITY.md or API.md.

---

### C. The `re` module is imported in chunking.py but never used
**Severity:** INFO
**File:** modules/chunking.py, line 3: `import re`

The `re` module is imported at the top of chunking.py but there is no regex usage anywhere in the file. This is dead import. Not mentioned in any doc.

---

### D. abortController is a module-level variable, not per-request — concurrent requests would break it
**Severity:** MINOR
**File:** static/js/script.js

```javascript
let abortController = null;
// ...
abortController = new AbortController();
```

The `abortController` is a single module-level variable. If a user somehow triggers two overlapping async operations (unlikely given the `isProcessing` guard but possible in edge cases), the second assignment overwrites the first controller, making it impossible to abort the first request. Not documented in KNOWN_LIMITATIONS.md.

---

### E. The `header-badge` CSS class used in index.html is not defined in style.css
**Severity:** MINOR
**File:** templates/index.html

```html
<div class="header-badge" id="appStatus">
    <span class="status-dot"></span> ⚖️ System Ready
</div>
```

The class `header-badge` appears in the HTML but has no corresponding CSS rule in `static/css/style.css`. This element will render without any custom styling. No documentation mentions this.

---

### F. The `upload-status` CSS class used in index.html is not defined in style.css
**Severity:** MINOR
**File:** templates/index.html, and referenced in script.js

```javascript
status.className = 'upload-status ' + type;
```

The `upload-status` base class and its type variants (`upload-status loading`, `upload-status success`, `upload-status error`) are referenced in JavaScript but not defined in style.css. The status div will render but without targeted styling.

---

### G. The `nav-item.ready` CSS class added by JS is not defined in style.css
**Severity:** MINOR
**File:** static/js/script.js

```javascript
if (enabled) btn.classList.add('ready');
```

The `ready` class is added to sidebar buttons after upload but has no CSS definition in style.css. This has no visual effect and is dead JS code.


---

## FINAL TALLY

### By Severity

| Severity | Count |
|---|---|
| CRITICAL | 4 |
| MAJOR | 13 |
| MINOR | 16 |
| INFO | 2 |
| **TOTAL** | **35** |

### By Documentation File

| File | Findings |
|---|---|
| AI_PIPELINE.md | 5 (Findings 1, 2, 3, 4, 5, 28) |
| ARCHITECTURE.md | 3 (Findings 6, 7, 8, 27) |
| API.md | 3 (Findings 9, 10, 11) |
| SECURITY.md | 3 (Findings 12, 13, 14) |
| DEPLOYMENT.md | 2 (Findings 15, 16) |
| KNOWN_LIMITATIONS.md | 3 (Findings 17, 18, 19) |
| PRODUCT.md | 3 (Findings 20, 21, 22) |
| DATABASE.md | 2 (Findings 23, 24) |
| ROADMAP.md | 1 (Finding 25) |
| All / Cross-file | 2 (Findings 26, 27) |
| Undocumented (not in any doc) | 7 (A through G) |

### By Category

| Category | Count |
|---|---|
| Incorrect count / number in docs | 3 (F1, F18, F28) |
| Feature implemented but undocumented | 4 (F7, F19, F21, F22 + A-G) |
| Doc states something code contradicts | 5 (F1, F4, F20, F28, F15) |
| Missing nuance / incomplete description | 8 (F2, F3, F5, F8, F9, F10, F13, F24) |
| Security risk undocumented | 3 (F12, F14, B) |
| File on disk not referenced in docs | 2 (F16, F26) |
| Dead code not documented | 3 (F7, F19, C) |
| CSS/JS inconsistency undocumented | 4 (E, F, G, D) |

---

## CRITICAL ITEMS — Summary for Quick Action

These four findings represent direct contradictions between the documentation and the code:

1. **AI_PIPELINE.md claims 18 legal boost words — actual set has 21.** (Finding 1)

2. **AI_PIPELINE.md claims "each prompt" includes the DISCLAIMER — only QUESTION_ANSWER_PROMPT does.** (Finding 4)

3. **KNOWN_LIMITATIONS.md worst-case fallback time is 109s — actual worst case with max_retries=1 is 214s.** (Finding 17)

4. **AI_PIPELINE.md states "each type has 5 keywords" — 7 of 12 document types have 3, 4, or 6 keywords.** (Finding 28)

---

*Audit performed by reading all 9 documentation files and all source files in full.
No documentation files were modified. No code was modified.*
*Audit date: 2026-07-04*
