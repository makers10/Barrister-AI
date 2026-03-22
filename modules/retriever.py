# modules/retriever.py
"""
Smart Retrieval for Barrister AI
- Page-context expansion (N-1, N, N+1)
- Section-aware retrieval
- Context reranking
"""

import re
import logging
from typing import List, Dict, Tuple
from langchain_core.documents import Document

logger = logging.getLogger(__name__)


def enhance_legal_query(query: str) -> str:
    """
    Enhance user query for better legal document retrieval.
    """
    query = query.strip()

    # Expand common abbreviations
    abbreviations = {
        r'\bwhat\'s\b': 'what is',
        r'\bhow\'s\b': 'how is',
        r'\bwhere\'s\b': 'where is',
        r'\bwho\'s\b': 'who is',
        r'\bcan\'t\b': 'cannot',
        r'\bwon\'t\b': 'will not',
        r'\bdon\'t\b': 'do not',
        r'\bNDA\b': 'non-disclosure agreement',
        r'\bIP\b': 'intellectual property',
        r'\bToS\b': 'terms of service',
    }

    for abbr, full in abbreviations.items():
        query = re.sub(abbr, full, query, flags=re.IGNORECASE)

    return query


def rerank_legal_contexts(
    query: str,
    docs_with_scores: List[Tuple[Document, float]]
) -> List[Document]:
    """
    Rerank retrieved documents with legal-awareness.
    
    Boosting factors:
    - Query term frequency
    - Legal keyword presence
    - Section relevance
    """
    query_terms = query.lower().split()

    # Legal importance keywords that boost relevance
    legal_boost_words = {
        'obligation', 'shall', 'must', 'liability', 'indemnify',
        'terminate', 'breach', 'penalty', 'warranty', 'damages',
        'confidential', 'dispute', 'arbitration', 'governing law',
        'force majeure', 'intellectual property', 'covenant',
        'representations', 'warranties', 'default', 'remedy'
    }

    reranked = []

    for doc, score in docs_with_scores:
        content_lower = doc.page_content.lower()

        # Term frequency score
        tf_score = sum(content_lower.count(term) for term in query_terms)

        # Legal keyword boost
        legal_score = sum(1 for word in legal_boost_words if word in content_lower)

        # Combined score (lower is better for FAISS distance)
        combined_score = score - (tf_score * 0.02) - (legal_score * 0.01)

        reranked.append((doc, combined_score))

    reranked.sort(key=lambda x: x[1])
    return [doc for doc, _ in reranked]


def build_legal_context(
    docs: List[Document],
    all_chunks: List[Dict] = None
) -> Tuple[str, List[Dict]]:
    """
    Build structured legal context from retrieved documents.
    
    Implements page index intelligence:
    - Includes page and section metadata
    - Expands cross-page clauses
    
    Returns:
        Tuple of (context_string, source_info_list)
    """
    context_parts = []
    source_info = []
    seen_chunks = set()

    for i, doc in enumerate(docs, 1):
        chunk_id = doc.metadata.get('chunk_id', 'N/A')

        # Skip duplicates
        if chunk_id in seen_chunks:
            continue
        seen_chunks.add(chunk_id)

        page = doc.metadata.get('page', 'N/A')
        pages = doc.metadata.get('pages', [page])
        section = doc.metadata.get('section', 'Unknown Section')

        # Format page range
        if isinstance(pages, list) and len(pages) > 1:
            page_str = f"Pages {pages[0]}-{pages[-1]}"
        else:
            page_str = f"Page {page}"

        # Build context entry with metadata
        entry = f"[Source {i} | {page_str} | Section: {section}]\n{doc.page_content}"
        context_parts.append(entry)

        source_info.append({
            'source_id': i,
            'page': page,
            'pages': pages,
            'section': section,
            'chunk_id': chunk_id
        })

    context = "\n\n---\n\n".join(context_parts)
    return context, source_info


def expand_page_context(
    primary_docs: List[Document],
    all_chunks: List[Dict]
) -> List[Document]:
    """
    Expand context using page index intelligence (N-1, N, N+1).
    
    For each retrieved document, also include chunks from
    adjacent pages to capture multi-page clauses.
    """
    if not all_chunks:
        return primary_docs

    # Collect pages from primary results
    target_pages = set()
    for doc in primary_docs:
        page = doc.metadata.get('page', 0)
        target_pages.update([page - 1, page, page + 1])

    # Collect chunk IDs already in primary results
    primary_chunk_ids = {doc.metadata.get('chunk_id') for doc in primary_docs}

    # Find additional chunks from adjacent pages
    expanded_docs = list(primary_docs)

    for chunk in all_chunks:
        if chunk['chunk_id'] not in primary_chunk_ids:
            if chunk['page'] in target_pages:
                expanded_docs.append(Document(
                    page_content=chunk['text'],
                    metadata={
                        'chunk_id': chunk['chunk_id'],
                        'page': chunk['page'],
                        'pages': chunk['pages'],
                        'section': chunk['section']
                    }
                ))

    # Limit total to avoid context overflow
    return expanded_docs[:10]
