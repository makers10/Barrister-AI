# modules/legal_analyzer.py
"""
Barrister AI Legal Analysis Orchestrator
- Coordinates PDF loading, chunking, retrieval, and LLM analysis
- Provides structured legal insights
- Handles model fallback
"""

import os
import time
import logging
from typing import Dict, Optional, List
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from modules.pdf_loader import load_pdf_with_pages, get_document_info
from modules.chunking import chunk_with_page_index
from modules.vector_store import create_vector_store, search_vector_store
from modules.retriever import (
    enhance_legal_query,
    rerank_legal_contexts,
    build_legal_context,
    expand_page_context
)
from modules.prompt_engine import get_prompt, BARRISTER_SYSTEM_PROMPT

load_dotenv()
logger = logging.getLogger(__name__)

# Free models to try (with fallback order)
FREE_MODELS = [
    "google/gemma-3-12b-it:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "meta-llama/llama-3.2-3b-instruct:free",
]


def _get_llm(model_name: str = None) -> ChatOpenAI:
    """Create an LLM instance for the given model."""
    return ChatOpenAI(
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        model_name=model_name or FREE_MODELS[0],
        default_headers={
            "HTTP-Referer": "http://localhost:5000",
            "X-Title": "Barrister AI"
        },
        temperature=0.3,  # Lower temperature for legal accuracy
        max_tokens=2000,   # Need more tokens for legal analysis
        request_timeout=60,
        max_retries=0
    )


def _invoke_llm_with_fallback(prompt_template: ChatPromptTemplate, variables: Dict) -> str:
    """
    Invoke LLM with automatic model fallback.
    Tries each model in FREE_MODELS until one succeeds.
    """
    for model_name in FREE_MODELS:
        try:
            logger.info(f"🤖 Trying model: {model_name}...")
            llm = _get_llm(model_name)
            chain = prompt_template | llm
            response = chain.invoke(variables)
            answer = response.content.strip()

            if answer and len(answer) > 20:
                logger.info(f"✅ Success with {model_name}")
                return answer

        except Exception as e:
            logger.warning(f"⚠️ {model_name} failed: {type(e).__name__}: {e}")
            time.sleep(5)
            continue

    logger.error("❌ All LLM models failed")
    return "⚠️ Unable to generate analysis at this time. All AI models are currently unavailable. Please try again in a few minutes."


# ==================== Document Processing ====================

def process_pdf(pdf_path: str) -> Dict:
    """
    Process a legal PDF document.
    
    Returns:
        Dict with:
        - 'pages_data': raw page data
        - 'chunks': section-indexed chunks
        - 'vector_store': FAISS index
        - 'doc_info': document metadata
        - 'success': bool
        - 'error': error message if any
    """
    try:
        # Step 1: Load PDF with page indexing
        pages_data = load_pdf_with_pages(pdf_path)

        if not pages_data:
            return {
                'success': False,
                'error': 'Failed to extract text from PDF. The file may be empty or a scanned image.'
            }

        # Step 2: Get document info
        doc_info = get_document_info(pages_data)

        # Step 3: Create page-indexed chunks
        chunks = chunk_with_page_index(pages_data)

        if not chunks:
            return {
                'success': False,
                'error': 'Failed to create document chunks. The PDF may not contain readable text.'
            }

        # Step 4: Create vector store
        cache_path = f"{os.path.basename(pdf_path)}.pkl"
        # Clear old cache
        if os.path.exists(cache_path):
            try:
                os.remove(cache_path)
            except Exception:
                pass

        vector_store = create_vector_store(chunks, cache_path=cache_path)

        if not vector_store:
            return {
                'success': False,
                'error': 'Failed to create search index.'
            }

        return {
            'success': True,
            'pages_data': pages_data,
            'chunks': chunks,
            'vector_store': vector_store,
            'doc_info': doc_info,
            'error': None
        }

    except Exception as e:
        logger.error(f"❌ PDF processing failed: {e}")
        return {
            'success': False,
            'error': f'Error processing PDF: {str(e)}'
        }


# ==================== Analysis Functions ====================

def full_analysis(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict:
    """
    Perform comprehensive legal analysis.
    
    Returns all analysis sections:
    - Document overview
    - Summary
    - Key points
    - Supported rules
    - Violated rules
    - Missing rules
    - Risks
    - Suggestions
    """
    # Retrieve broad context (use more chunks for full analysis)
    all_results = search_vector_store(vector_store, "legal terms obligations rights", top_k=10)
    docs = rerank_legal_contexts("legal terms obligations rights conditions", all_results)
    docs = expand_page_context(docs, chunks)
    context, sources = build_legal_context(docs, chunks)

    # Build sections summary
    all_sections = []
    for chunk in chunks:
        if chunk['section'] and chunk['section'] not in all_sections:
            all_sections.append(chunk['section'])
    sections_summary = ", ".join(all_sections[:20]) if all_sections else "No specific sections detected"

    doc_type = ", ".join(doc_info.get('detected_types', ['Unknown'])) or 'Unknown'

    # Create prompt
    prompt_template = ChatPromptTemplate.from_messages([
        ("user", get_prompt('full_analysis'))
    ])

    # Invoke LLM
    answer = _invoke_llm_with_fallback(prompt_template, {
        'context': context,
        'total_pages': doc_info.get('total_pages', 'Unknown'),
        'doc_type': doc_type,
        'sections_summary': sections_summary
    })

    return {
        'analysis': answer,
        'sources': sources,
        'doc_info': doc_info
    }


def ask_question(
    vector_store,
    chunks: List[Dict],
    doc_info: Dict,
    question: str
) -> Dict:
    """
    Answer a specific legal question about the document.
    """
    # Enhance query
    enhanced_query = enhance_legal_query(question)

    # Search
    results = search_vector_store(vector_store, enhanced_query, top_k=6)

    # Rerank with legal awareness
    docs = rerank_legal_contexts(enhanced_query, results)

    # Expand page context
    docs = expand_page_context(docs, chunks)

    # Build context
    context, sources = build_legal_context(docs, chunks)

    # Create prompt
    prompt_template = ChatPromptTemplate.from_messages([
        ("user", get_prompt('question'))
    ])

    # Invoke LLM
    answer = _invoke_llm_with_fallback(prompt_template, {
        'context': context,
        'question': question
    })

    return {
        'answer': answer,
        'sources': sources
    }


def get_summary(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict:
    """Generate a structured summary of the document."""
    results = search_vector_store(vector_store, "summary overview purpose scope", top_k=8)
    docs = rerank_legal_contexts("summary overview purpose", results)
    docs = expand_page_context(docs, chunks)
    context, sources = build_legal_context(docs, chunks)

    doc_type = ", ".join(doc_info.get('detected_types', ['Unknown'])) or 'Unknown'

    prompt_template = ChatPromptTemplate.from_messages([
        ("user", get_prompt('summary'))
    ])

    answer = _invoke_llm_with_fallback(prompt_template, {
        'context': context,
        'total_pages': doc_info.get('total_pages', 'Unknown'),
        'doc_type': doc_type
    })

    return {
        'summary': answer,
        'sources': sources
    }


def get_risk_analysis(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict:
    """Perform risk and red flag analysis."""
    results = search_vector_store(
        vector_store,
        "liability risk penalty termination breach indemnify limitation",
        top_k=8
    )
    docs = rerank_legal_contexts("risk liability termination breach penalty", results)
    docs = expand_page_context(docs, chunks)
    context, sources = build_legal_context(docs, chunks)

    prompt_template = ChatPromptTemplate.from_messages([
        ("user", get_prompt('risk_analysis'))
    ])

    answer = _invoke_llm_with_fallback(prompt_template, {
        'context': context
    })

    return {
        'risk_analysis': answer,
        'sources': sources
    }


def get_key_points(vector_store, chunks: List[Dict], doc_info: Dict) -> Dict:
    """Extract key points from the document."""
    results = search_vector_store(
        vector_store,
        "obligations rights payment deadline penalty condition",
        top_k=8
    )
    docs = rerank_legal_contexts("obligations rights terms conditions", results)
    docs = expand_page_context(docs, chunks)
    context, sources = build_legal_context(docs, chunks)

    prompt_template = ChatPromptTemplate.from_messages([
        ("user", get_prompt('key_points'))
    ])

    answer = _invoke_llm_with_fallback(prompt_template, {
        'context': context
    })

    return {
        'key_points': answer,
        'sources': sources
    }
