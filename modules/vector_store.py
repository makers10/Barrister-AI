# modules/vector_store.py
"""
Vector Store Management for Barrister AI
- FAISS vector store with page-indexed metadata
- Pickle-based caching
"""

import os
import pickle
import logging
from typing import List, Dict, Optional, Tuple
from langchain_community.vectorstores.faiss import FAISS
from langchain_core.documents import Document
from modules.embedding import get_embedding_model

logger = logging.getLogger(__name__)


def create_vector_store(chunks: List[Dict], cache_path: Optional[str] = None) -> Optional[FAISS]:
    """
    Create a FAISS vector store from page-indexed chunks.
    
    Each document includes metadata:
    - chunk_id
    - page (primary page)
    - pages (all pages this chunk spans)
    - section (legal section header)
    """
    if not chunks:
        logger.error("❌ No chunks provided to create vector store")
        return None

    # Check for cached vector store
    if cache_path and os.path.exists(cache_path):
        try:
            with open(cache_path, "rb") as f:
                vector_store = pickle.load(f)
            logger.info("✅ Loaded cached vector store")
            return vector_store
        except Exception as e:
            logger.warning(f"⚠️ Failed to load cache, rebuilding: {e}")

    # Create LangChain documents with metadata
    documents = []
    for chunk in chunks:
        doc = Document(
            page_content=chunk['text'],
            metadata={
                'chunk_id': chunk['chunk_id'],
                'page': chunk['page'],
                'pages': chunk['pages'],
                'section': chunk['section']
            }
        )
        documents.append(doc)

    # Build vector store
    try:
        logger.info(f"🔧 Creating FAISS index with {len(documents)} documents...")
        embedding_model = get_embedding_model()
        vector_store = FAISS.from_documents(documents, embedding_model)
        logger.info("✅ FAISS vector store created")

        # Cache
        if cache_path:
            try:
                with open(cache_path, "wb") as f:
                    pickle.dump(vector_store, f)
                logger.info(f"💾 Vector store cached to {cache_path}")
            except Exception as e:
                logger.warning(f"⚠️ Failed to cache vector store: {e}")

        return vector_store

    except Exception as e:
        logger.error(f"❌ Failed to create vector store: {e}")
        return None


def search_vector_store(
    vector_store: FAISS,
    query: str,
    top_k: int = 6,
    use_hybrid: bool = True
) -> List[Tuple[Document, float]]:
    """
    Search vector store with optional hybrid scoring.
    
    Combines:
    1. Semantic similarity (FAISS)
    2. Keyword boosting (BM25-like)
    """
    # Semantic search
    results = vector_store.similarity_search_with_score(query, k=top_k * 2)

    if use_hybrid:
        # Keyword boosting
        query_words = set(query.lower().split())
        boosted = []

        for doc, score in results:
            doc_words = set(doc.page_content.lower().split())
            overlap = len(query_words.intersection(doc_words))
            keyword_boost = overlap * 0.05
            adjusted_score = score - keyword_boost
            boosted.append((doc, adjusted_score))

        boosted.sort(key=lambda x: x[1])
        return boosted[:top_k]

    return results[:top_k]
