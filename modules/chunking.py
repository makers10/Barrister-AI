# modules/chunking.py
"""
Section-Aware Legal Document Chunking for Barrister AI
- Preserves page boundaries
- Keeps legal sections intact
- Maintains page index metadata
"""

import re
import logging
from typing import List, Dict
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)


def chunk_with_page_index(
    pages_data: List[Dict],
    chunk_size: int = 800,
    chunk_overlap: int = 200
) -> List[Dict]:
    """
    Create chunks that preserve page index and section context.
    
    Each chunk contains:
    - 'text': chunk content
    - 'page': primary page number
    - 'pages': list of page numbers this chunk spans
    - 'section': detected section header (if any)
    - 'chunk_id': sequential identifier
    
    Strategy:
    1. Process page by page
    2. Track section headers
    3. Split within pages maintaining section context
    4. Add page index metadata to every chunk
    """
    if not pages_data:
        return []

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", ". ", "; ", ", ", " ", ""]
    )

    all_chunks = []
    current_section = "Document Start"
    chunk_id = 0

    for page_data in pages_data:
        page_num = page_data['page']
        page_text = page_data['text']
        page_sections = page_data['sections']

        # Update current section from this page
        if page_sections:
            current_section = page_sections[0]

        if not page_text or len(page_text.strip()) < 10:
            continue

        # Split the page text
        page_chunks = splitter.split_text(page_text)

        for chunk_text in page_chunks:
            if len(chunk_text.strip()) < 10:
                continue

            # Check if this chunk starts a new section
            chunk_section = current_section
            for section in page_sections:
                if section.lower() in chunk_text.lower()[:200]:
                    chunk_section = section
                    current_section = section
                    break

            all_chunks.append({
                'text': chunk_text,
                'page': page_num,
                'pages': [page_num],
                'section': chunk_section,
                'chunk_id': chunk_id
            })
            chunk_id += 1

    # Post-processing: merge cross-page context for boundary chunks
    all_chunks = _merge_boundary_chunks(all_chunks)

    logger.info(f"📦 Created {len(all_chunks)} section-aware chunks")
    return all_chunks


def _merge_boundary_chunks(chunks: List[Dict]) -> List[Dict]:
    """
    For chunks at page boundaries, expand page references
    to include N-1 and N+1 pages.
    """
    for i, chunk in enumerate(chunks):
        pages = set(chunk['pages'])

        # Check if previous chunk is from a different page (boundary)
        if i > 0 and chunks[i - 1]['page'] != chunk['page']:
            pages.add(chunks[i - 1]['page'])

        # Check if next chunk is from a different page (boundary)
        if i < len(chunks) - 1 and chunks[i + 1]['page'] != chunk['page']:
            pages.add(chunks[i + 1]['page'])

        chunk['pages'] = sorted(pages)

    return chunks


def get_expanded_context(
    chunks: List[Dict],
    target_page: int,
    target_section: str = None
) -> List[Dict]:
    """
    Get expanded context for a page using N-1, N, N+1 strategy.
    
    This implements the Page Index Intelligence principle:
    - Previous page (N-1)
    - Current page (N)
    - Next page (N+1)
    
    Optionally filter by section.
    """
    expanded_pages = {target_page - 1, target_page, target_page + 1}

    relevant_chunks = []
    for chunk in chunks:
        # Check if any of the chunk's pages are in our expanded range
        if any(p in expanded_pages for p in chunk['pages']):
            if target_section:
                # If section filter, also include chunks from same section
                if chunk['section'] and target_section.lower() in chunk['section'].lower():
                    relevant_chunks.append(chunk)
                elif any(p in expanded_pages for p in chunk['pages']):
                    relevant_chunks.append(chunk)
            else:
                relevant_chunks.append(chunk)

    return relevant_chunks
