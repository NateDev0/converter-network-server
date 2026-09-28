"""pdf_to_xlsx.py <in.pdf> <out.xlsx>

Every table pdfplumber finds becomes its own sheet. Pages without tables fall back to one row per
text line, so the user always gets their data.
"""
import sys

import pdfplumber
from openpyxl import Workbook

src, out = sys.argv[1], sys.argv[2]
wb = Workbook()
wb.remove(wb.active)
with pdfplumber.open(src) as pdf:
    for page_no, page in enumerate(pdf.pages, start=1):
        tables = [t for t in page.extract_tables() if t]
        if tables:
            for t_no, table in enumerate(tables, start=1):
                ws = wb.create_sheet(f"Page {page_no}" + (f" ({t_no})" if len(tables) > 1 else ""))
                for row in table:
                    ws.append(["" if c is None else c for c in row])
        else:
            text = page.extract_text() or ""
            if text.strip():
                ws = wb.create_sheet(f"Page {page_no}")
                for line in text.splitlines():
                    ws.append([line])
if not wb.sheetnames:
    wb.create_sheet("Page 1").append(["No text found. Try OCR first."])
wb.save(out)
