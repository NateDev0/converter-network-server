"""collect_pages.py <dir> <out> <ext> <auto|zip>

Gathers page files (page-1.ext, page-02.ext, ...) in page order. In "auto" mode a single page is
copied as-is; otherwise every page goes into an uncompressed ZIP named page-N.ext.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

src, out, ext, mode = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
# pdftoppm writes .jpg for -jpeg
pattern = re.compile(r"(\d+)\.(%s|jpeg)$" % re.escape(ext))
pages = sorted((int(m.group(1)), p) for p in src.iterdir() if (m := pattern.search(p.name)))
if not pages:
    sys.exit("no pages")
if mode == "auto" and len(pages) == 1:
    shutil.copyfile(pages[0][1], out)
else:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for n, p in pages:
            z.write(p, f"page-{n}.{ext}")
