# modules/vector_store.py
"""
Vector Store Management for Barrister AI
- Supabase pgvector store with page-indexed metadata
- Cloud-native, no local caching required
"""

import os
import logging
from typing import List, Dict, Optional, Tuple
from langchain_community.vectorstores.supabase import SupabaseVectorStore
from langchain_core.documents import Document
from modules.embedding import get_embedding_model

logger = logging.getLogger(__name__)


def _get_supabase_client():
    from supabase import create_client, Client
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        return None
    return create_client(supabase_url, supabase_key)


def create_vector_store(chunks: List[Dict], session_id: str) -> Optional[SupabaseVectorStore]:
    """
    Create a Supabase vector store from page-indexed chunks.
    
    Each document includes metadata:
    - session_id (for isolating searches)
    - chunk_id
    - page (primary page)
    - pages (all pages this chunk spans)
    - section (legal section header)
    """
    if not chunks:
        logger.error("❌ No chunks provided to create vector store")
        return None

    supabase = _get_supabase_client()
    if not supabase:
        logger.error("❌ Supabase client not configured")
        return None

    # Create LangChain documents with metadata
    documents = []
    for chunk in chunks:
        doc = Document(
            page_content=chunk['text'],
            metadata={
                'session_id': session_id,
                'chunk_id': chunk['chunk_id'],
                'page': chunk['page'],
                'pages': chunk['pages'],
                'section': chunk['section']
            }
        )
        documents.append(doc)

    # Build vector store
    try:
        logger.info(f"🔧 Creating Supabase pgvector index with {len(documents)} documents...")
        embedding_model = get_embedding_model()
        vector_store = SupabaseVectorStore.from_documents(
            documents,
            embedding_model,
            client=supabase,
            table_name="documents",
            query_name="match_documents"
        )
        logger.info("✅ Supabase vector store created")
        return vector_store

    except Exception as e:
        logger.error(f"❌ Failed to create vector store: {e}")
        return None


def get_vector_store() -> Optional[SupabaseVectorStore]:
    """Get an instance of the vector store for searching."""
    supabase = _get_supabase_client()
    if not supabase:
        return None
        
    embedding_model = get_embedding_model()
    return SupabaseVectorStore(
        client=supabase,
        embedding=embedding_model,
        table_name="documents",
        query_name="match_documents"
    )


def search_vector_store(
    vector_store: SupabaseVectorStore,
    query: str,
    session_id: str,
    top_k: int = 6,
    use_hybrid: bool = True
) -> List[Tuple[Document, float]]:
    """
    Search vector store isolated by session_id.
    """
    # Semantic search with filter
    filter_dict = {"session_id": session_id}
    results = vector_store.similarity_search_with_relevance_scores(
        query, 
        k=top_k * 2,
        filter=filter_dict
    )
    
    # Supabase returns (Document, relevance_score) where higher is better.
    # We will normalize it to distance (lower is better) to match previous FAISS logic
    # or just use it as is if hybrid scoring needs tweaking.
    # In FAISS, lower score = smaller distance = better match.
    # In relevance_scores, higher score = better match.
    
    # We will invert the score for compatibility with existing rerank logic which expects lower=better
    # Actually, previous code expected lower=better.
    normalized_results = [(doc, 1.0 - score) for doc, score in results]

    if use_hybrid:
        # Keyword boosting
        query_words = set(query.lower().split())
        boosted = []

        for doc, dist in normalized_results:
            doc_words = set(doc.page_content.lower().split())
            overlap = len(query_words.intersection(doc_words))
            keyword_boost = overlap * 0.05
            adjusted_score = dist - keyword_boost
            boosted.append((doc, adjusted_score))

        boosted.sort(key=lambda x: x[1])
        return boosted[:top_k]

    normalized_results.sort(key=lambda x: x[1])
    return normalized_results[:top_k]
