# modules/embedding.py
"""
Embedding Model for Barrister AI
Uses all-MiniLM-L6-v2 for efficient, high-quality embeddings
"""

import logging
from langchain_community.embeddings import HuggingFaceEmbeddings

logger = logging.getLogger(__name__)

_embedding_model = None


def get_embedding_model():
    """
    Get or create the embedding model (singleton pattern).
    Uses all-MiniLM-L6-v2 — lightweight yet effective for legal text.
    """
    global _embedding_model

    if _embedding_model is not None:
        return _embedding_model

    logger.info("🔧 Loading embedding model: all-MiniLM-L6-v2...")

    _embedding_model = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={
            "normalize_embeddings": True,
            "batch_size": 32
        }
    )

    logger.info("✅ Embedding model loaded")
    return _embedding_model
