# AI_PIPELINE.md — Barrister AI

## Overview

Barrister AI uses a Retrieval-Augmented Generation (RAG) pipeline. A PDF document is processed into a searchable vector index, and at query time the most relevant chunks are retrieved and passed to an LLM as context.

---

## Stage 1: PDF Ingestion

**Module:** `modules/pdf_loader.py`  
**Function:** `load_pdf_with_pages(file_path)`  
**Library:** `PyPDF2.PdfReader`

### Steps

1. Open the PDF with `PdfReader`
2. For each page, call `page.extract_text()` — returns raw text string or empty string
3. Pass each page's text through `fix_doubled_text()`:
   - Samples the first 500 characters (excluding spaces and newlines)
   - Checks if >60% of consecutive character pairs are identical
   - If so, removes every second duplicate character (fixes a known encoding artifact in some PDFs)
4. For each line on each page, call `detect_section_header()`:
   - Matches 11 regex patterns for legal section formats (ARTICLE, SECTION, CLAUSE, SCHEDULE, APPENDIX, PART, EXHIBIT, RECITAL, WHEREAS/WITNESSETH/NOW THEREFORE, numbered+caps, numbered decimal)
   - Also matches any all-caps line between 5 and 100 characters
5. Returns `pages_data`: a list of `{"page": int, "text": str, "sections": List[str]}`

### Document Type Detection

**Function:** `get_document_info(pages_data)`

- Concatenates all page text and lowercases it
- Checks for keyword presence across 12 document type definitions
- Each type has 5 keywords; a type is flagged if at least 2 keywords are found
- Types are ranked by keyword match count; top 3 are returned as `detected_types`

---

## Stage 2: Chunking

**Module:** `modules/chunking.py`  
**Function:** `chunk_with_page_index(pages_data, chunk_size=800, chunk_overlap=200)`  
**Library:** `langchain_text_splitters.RecursiveCharacterTextSplitter`

### Steps

1. Iterate through each page's text
2. Maintain a `current_section` variable that updates whenever a section header is found at the top of a page
3. Split each page's text with `RecursiveCharacterTextSplitter`:
   - `chunk_size=800` characters
   - `chunk_overlap=200` characters
   - Separators tried in order: `\n\n`, `\n`, `. `, `; `, `, `, ` `, `""`
4. For each chunk, check if any section header from the current page appears in the first 200 characters of the chunk text; update `chunk_section` if found
5. Assign metadata to each chunk: `text`, `page`, `pages`, `section`, `chunk_id` (sequential integer)
6. Post-process with `_merge_boundary_chunks()`:
   - For chunks at page transitions (i.e., the previous or next chunk is on a different page), add the adjacent page number to the chunk's `pages` list

### Output

A flat list of chunk dicts. Each chunk knows which page(s) it came from and which legal section it belongs to.

---

## Stage 3: Embedding

**Module:** `modules/embedding.py`  
**Function:** `get_embedding_model()` — singleton  
**Library:** `langchain_community.embeddings.HuggingFaceEmbeddings`  
**Model:** `sentence-transformers/all-MiniLM-L6-v2`

### Configuration

| Parameter | Value |
|---|---|
| Model | `sentence-transformers/all-MiniLM-L6-v2` |
| Device | `cpu` |
| Normalize embeddings | `True` |
| Batch size | `32` |

### Behaviour

- Model is loaded from HuggingFace Hub on first use (requires internet access)
- Model is cached in memory as a module-level singleton for the lifetime of the process
- Subsequent calls to `get_embedding_model()` return the same instance

**Observed from logs:** First load takes approximately 8 seconds, including multiple HEAD requests to HuggingFace's CDN to resolve model cache.

---

## Stage 4: Vector Store

**Module:** `modules/vector_store.py`  
**Function:** `create_vector_store(chunks, cache_path)`  
**Library:** `langchain_community.vectorstores.faiss.FAISS`  
**Backend:** FAISS with AVX2 support (confirmed in server logs)

### Steps

1. Convert each chunk dict to a `langchain_core.documents.Document` with `page_content` and `metadata`
2. Call `FAISS.from_documents(documents, embedding_model)` — embeds all chunks and builds the index
3. Serialize the FAISS object to disk as a pickle file at `cache_path`

### Search

**Function:** `search_vector_store(vector_store, query, top_k, use_hybrid=True)`

1. Call `vector_store.similarity_search_with_score(query, k=top_k * 2)` — returns `(Document, float)` pairs where the float is the FAISS L2 distance (lower = more similar)
2. If `use_hybrid=True`:
   - Count word overlap between query and each document
   - Subtract `overlap * 0.05` from the FAISS score
   - Re-sort by adjusted score
   - Return top `top_k` results

---

## Stage 5: Retrieval & Reranking

**Module:** `modules/retriever.py`

### Query Enhancement

**Function:** `enhance_legal_query(query)`

Expands common abbreviations and contractions using regex substitution:
- `NDA` → `non-disclosure agreement`
- `IP` → `intellectual property`
- `ToS` → `terms of service`
- Contractions: `what's`, `how's`, `where's`, `who's`, `can't`, `won't`, `don't`

### Reranking

**Function:** `rerank_legal_contexts(query, docs_with_scores)`

For each retrieved document:
1. Compute term frequency score: count occurrences of each query word in the document
2. Compute legal keyword score: count matches against 18 boost words:
   `obligation, shall, must, liability, indemnify, terminate, breach, penalty, warranty, damages, confidential, dispute, arbitration, governing law, force majeure, intellectual property, covenant, representations, warranties, default, remedy`
3. Combined score = `faiss_score - (tf_score * 0.02) - (legal_score * 0.01)`
4. Re-sort ascending by combined score

### Page Context Expansion

**Function:** `expand_page_context(primary_docs, all_chunks)`

For each document in the primary results:
- Compute target pages: `page - 1`, `page`, `page + 1`
- Find chunks in `all_chunks` that fall on any of these pages but are NOT already in the primary results
- Append them to the results list
- Cap total at 10 documents

### Context Assembly

**Function:** `build_legal_context(docs, all_chunks)`

- Deduplicates by `chunk_id`
- Formats each document as:
  ```
  [Source N | Page X | Section: <section>]
  <chunk text>
  ```
  or for multi-page chunks:
  ```
  [Source N | Pages X-Y | Section: <section>]
  ```
- Joins all entries with `\n\n---\n\n`
- Returns `(context_string, source_info_list)`

---

## Stage 6: LLM Inference

**Module:** `modules/legal_analyzer.py`  
**Function:** `_invoke_llm_with_fallback(prompt_template, variables)`  
**Library:** `langchain_openai.ChatOpenAI` with custom base URL  
**Endpoint:** `https://openrouter.ai/api/v1/chat/completions`

### Model Fallback Chain

| Order | Model |
|---|---|
| 1 (primary) | `google/gemma-3-12b-it:free` |
| 2 (fallback) | `mistralai/mistral-small-3.1-24b-instruct:free` |
| 3 (fallback) | `meta-llama/llama-3.2-3b-instruct:free` |

All three are free-tier models on OpenRouter.

### LLM Configuration

| Parameter | Value |
|---|---|
| `temperature` | `0.3` |
| `max_tokens` | `2000` |
| `request_timeout` | `35` seconds |
| `max_retries` | `1` |
| `HTTP-Referer` header | `http://localhost:5000` |
| `X-Title` header | `Barrister AI` |

### Fallback Logic

1. Try model 1; if it returns a non-empty response (>20 chars), return it
2. If it fails (any exception), log the error, sleep 2 seconds, try model 2
3. Repeat for model 3
4. If all fail, return a static error message string

---

## Prompt Templates

**Module:** `modules/prompt_engine.py`

All prompts are single user-turn messages (no system message role is used in the actual chain calls). `BARRISTER_SYSTEM_PROMPT` is defined but not passed to any LangChain chain in the current code.

| Template Constant | Used By | Key Variables |
|---|---|---|
| `FULL_ANALYSIS_PROMPT` | `full_analysis()` | `{context}`, `{total_pages}`, `{doc_type}`, `{sections_summary}` |
| `QUESTION_ANSWER_PROMPT` | `ask_question()` | `{context}`, `{question}` |
| `SUMMARY_PROMPT` | `get_summary()` | `{context}`, `{total_pages}`, `{doc_type}` |
| `RISK_ANALYSIS_PROMPT` | `get_risk_analysis()` | `{context}` |
| `KEY_POINTS_PROMPT` | `get_key_points()` | `{context}` |

Each prompt explicitly instructs the LLM to:
- Use only the provided context (no hallucination)
- Include section names and page numbers in every claim
- Use a specific output structure (markdown headers)
- End with: `"DISCLAIMER: This is an AI-based analysis and not legal advice."`

---

## Query-to-Response: End-to-End Flow (Ask Question Example)

```
User question: "What is the notice period for termination?"
        │
        ▼
enhance_legal_query()
  "What is the notice period for termination?"  (no abbreviations to expand)
        │
        ▼
search_vector_store(vector_store, query, top_k=6)
  → FAISS similarity search (k=12), hybrid keyword boost, return top 6
        │
        ▼
rerank_legal_contexts(query, results)
  → Re-score by TF + legal keyword boost, re-sort
        │
        ▼
expand_page_context(docs, all_chunks)
  → Add chunks from adjacent pages, cap at 10 total
        │
        ▼
build_legal_context(docs, all_chunks)
  → Assemble "[Source 1 | Page 3 | Section: ...]" context string
        │
        ▼
ChatPromptTemplate.from_messages([("user", QUESTION_ANSWER_PROMPT)])
  .invoke({"context": context, "question": question})
        │
        ▼
OpenRouter API → google/gemma-3-12b-it:free
  (fallback to mistral → llama if failed)
        │
        ▼
response.content.strip()
        │
        ▼
{"success": true, "answer": "...", "sources": [...]}
```

---

## Retrieval Parameters by Endpoint

| Endpoint | `top_k` | Search Query |
|---|---|---|
| `/analyze` | 10 | `"legal terms obligations rights"` |
| `/summary` | 8 | `"summary overview purpose scope"` |
| `/risks` | 8 | `"liability risk penalty termination breach indemnify limitation"` |
| `/keypoints` | 8 | `"obligations rights payment deadline penalty condition"` |
| `/ask` | 6 | User's question (enhanced) |
