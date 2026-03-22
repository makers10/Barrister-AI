# modules/pdf_loader.py
"""
Page-Indexed PDF Loader for Barrister AI
- Extracts text with page number tracking
- Detects legal section headers
- Preserves document structure
"""

import re
import logging
from typing import List, Dict, Optional
from PyPDF2 import PdfReader

logger = logging.getLogger(__name__)


def fix_doubled_text(text: str) -> str:
    """Fix doubled characters in PDF text extraction."""
    if not text:
        return text

    sample = text[:500].replace(' ', '').replace('\n', '')
    if len(sample) < 10:
        return text

    double_count = 0
    total_pairs = 0
    for i in range(0, len(sample) - 1, 2):
        total_pairs += 1
        if sample[i] == sample[i + 1]:
            double_count += 1

    if total_pairs > 0 and (double_count / total_pairs) > 0.6:
        logger.info("🔧 Detected doubled characters, fixing...")
        fixed = ""
        i = 0
        while i < len(text):
            fixed += text[i]
            if i + 1 < len(text) and text[i] == text[i + 1] and text[i] not in ' \n\r\t':
                i += 2
            else:
                i += 1
        return fixed

    return text


def detect_section_header(line: str) -> Optional[str]:
    """
    Detect if a line is a legal section header.
    
    Matches patterns like:
    - "ARTICLE 1: ..."
    - "Section 2.1 ..."
    - "CLAUSE 3 - ..."
    - "1. DEFINITIONS"
    - "SCHEDULE A"
    - "APPENDIX 1"
    - "PART I"
    - All caps lines (likely headers)
    """
    line = line.strip()
    if not line or len(line) < 3:
        return None

    # Common legal section patterns
    patterns = [
        r'^(ARTICLE|Article)\s+\d+[\.:;\-\s]',
        r'^(SECTION|Section)\s+\d+[\.\d]*[\.:;\-\s]',
        r'^(CLAUSE|Clause)\s+\d+[\.\d]*[\.:;\-\s]',
        r'^(SCHEDULE|Schedule)\s+[A-Z\d]+',
        r'^(APPENDIX|Appendix)\s+[A-Z\d]+',
        r'^(PART|Part)\s+[IVXLCDM\d]+',
        r'^(EXHIBIT|Exhibit)\s+[A-Z\d]+',
        r'^(RECITAL|Recital)[S]?\s*',
        r'^(WHEREAS|WITNESSETH|NOW\s*,?\s*THEREFORE)',
        r'^\d+\.\s+[A-Z][A-Z\s]{3,}',  # "1. DEFINITIONS"
        r'^\d+\.\d+\s+[A-Z]',  # "1.1 Something"
    ]

    for pattern in patterns:
        if re.match(pattern, line):
            return line

    # All caps lines over 5 chars (likely headers)
    if line.isupper() and len(line) > 5 and len(line) < 100:
        return line

    return None


def load_pdf_with_pages(file_path: str) -> List[Dict]:
    """
    Load PDF with page-level indexing.
    
    Returns:
        List of dicts with:
        - 'page': page number (1-indexed)
        - 'text': page text content
        - 'sections': detected section headers on this page
    """
    logger.info(f"📄 Loading PDF: {file_path}")
    pages_data = []

    try:
        reader = PdfReader(file_path)
        total_pages = len(reader.pages)
        logger.info(f"📖 PDF has {total_pages} pages")

        for page_num, page in enumerate(reader.pages, 1):
            page_text = page.extract_text() or ""
            page_text = fix_doubled_text(page_text)

            # Detect sections on this page
            sections = []
            for line in page_text.split('\n'):
                header = detect_section_header(line)
                if header:
                    sections.append(header)

            pages_data.append({
                'page': page_num,
                'text': page_text,
                'sections': sections
            })

        total_chars = sum(len(p['text']) for p in pages_data)
        total_sections = sum(len(p['sections']) for p in pages_data)
        logger.info(f"📝 Extracted {total_chars} chars, {total_sections} sections from {total_pages} pages")

    except Exception as e:
        logger.error(f"❌ Error reading PDF: {e}")
        return []

    return pages_data


def get_document_info(pages_data: List[Dict]) -> Dict:
    """
    Extract document overview information.
    
    Returns:
        Dict with document type hints, total pages, all sections found
    """
    all_text = " ".join(p['text'] for p in pages_data).lower()
    all_sections = []
    for p in pages_data:
        for s in p['sections']:
            all_sections.append({'section': s, 'page': p['page']})

    # Detect document type
    doc_type_hints = []
    type_keywords = {
        'Employment Agreement': ['employment', 'employee', 'employer', 'salary', 'termination of employment'],
        'Non-Disclosure Agreement': ['confidential', 'nda', 'non-disclosure', 'proprietary information'],
        'Service Agreement': ['service provider', 'services', 'scope of work', 'deliverables'],
        'Lease Agreement': ['lease', 'tenant', 'landlord', 'premises', 'rent'],
        'Sales Contract': ['purchase', 'buyer', 'seller', 'goods', 'delivery'],
        'Partnership Agreement': ['partner', 'partnership', 'profit sharing', 'capital contribution'],
        'Loan Agreement': ['loan', 'borrower', 'lender', 'interest rate', 'repayment'],
        'License Agreement': ['license', 'licensor', 'licensee', 'royalty', 'intellectual property'],
        'Terms of Service': ['terms of service', 'terms and conditions', 'user agreement'],
        'Privacy Policy': ['privacy', 'personal data', 'data protection', 'gdpr'],
        'Merger Agreement': ['merger', 'acquisition', 'closing', 'shareholders'],
        'Insurance Policy': ['insurance', 'insured', 'insurer', 'premium', 'claim', 'coverage'],
    }

    for doc_type, keywords in type_keywords.items():
        matches = sum(1 for kw in keywords if kw in all_text)
        if matches >= 2:
            doc_type_hints.append((doc_type, matches))

    doc_type_hints.sort(key=lambda x: x[1], reverse=True)

    return {
        'total_pages': len(pages_data),
        'total_characters': sum(len(p['text']) for p in pages_data),
        'detected_types': [t[0] for t in doc_type_hints[:3]],
        'sections': all_sections,
        'total_sections': len(all_sections)
    }
