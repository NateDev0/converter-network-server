"""delete_pages.py <in.pdf> <ranges> <out.pdf>

<ranges> is already validated, e.g. "1-3,5,8-z" (1-based; "z" = last page).
"""
import sys

import pymupdf

src, ranges, out = sys.argv[1], sys.argv[2], sys.argv[3]
doc = pymupdf.open(src)
last = doc.page_count
drop = set()
for part in ranges.split(","):
    start, dash, end = part.partition("-")
    a = int(start)
    b = a if not dash else (last if end in ("", "z") else int(end))
    if a < 1 or b > last or a > b:
        sys.exit("invalid page selection")
    drop.update(range(a, b + 1))
keep = [i for i in range(last) if i + 1 not in drop]
if not keep:
    sys.exit("cannot delete every page")
doc.select(keep)
doc.save(out, garbage=3, deflate=True)
