"""pdf_to_docx.py <in.pdf> <out.docx>

pdf2docx (MIT) on PyMuPDF (AGPL-3.0). Rebuilds paragraphs, tables and images as editable Word content.
Source for this server is published as required by the AGPL: see /open-source on each site.
"""
import logging
import sys

from pdf2docx import Converter

logging.disable(logging.CRITICAL)  # pdf2docx logs page text at INFO level; never log document content
src, out = sys.argv[1], sys.argv[2]
cv = Converter(src)
try:
    cv.convert(out, multi_processing=False)
finally:
    cv.close()
