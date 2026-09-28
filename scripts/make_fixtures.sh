#!/bin/sh
# Builds sample files for the integration tests, using only the tools in the image.
set -eu
FX="$1"; mkdir -p "$FX"; cd "$FX"
export HOME="$FX"
i=1; : > sample.txt
while [ $i -le 90 ]; do echo "Line $i of the PDF Canary sample document. Quarterly revenue grew." >> sample.txt; i=$((i+1)); done
printf 'name,price,note\nWidget,1.95,"has, comma"\nGadget,2.95,plain\n' > sample.csv
printf '<!doctype html><html><body><h1>Canary</h1><p>Hello from HTML.</p></body></html>' > sample.html
soffice --headless --convert-to docx:"MS Word 2007 XML" sample.txt >/dev/null
soffice --headless --convert-to odt sample.txt >/dev/null
soffice --headless --convert-to rtf sample.txt >/dev/null
soffice --headless --convert-to xlsx:"Calc MS Excel 2007 XML" sample.csv >/dev/null
soffice --headless --convert-to pdf sample.docx >/dev/null
cp sample.xlsx table.xlsx && soffice --headless --convert-to pdf table.xlsx >/dev/null && mv table.pdf sample-table.pdf
/opt/venv/bin/python -c "
from pptx import Presentation
p = Presentation(); s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text = 'Canary'; p.save('sample.pptx')"
pdftoppm -png -r 60 -f 1 -l 1 -singlefile sample.pdf sample
pdftoppm -jpeg -r 60 -f 1 -l 1 -singlefile sample.pdf sample
pdftoppm -png -r 200 -f 1 -l 1 -singlefile sample.pdf scan && img2pdf scan.png -o sample-scanned.pdf
qpdf --encrypt pw pw 256 -- sample.pdf sample-protected.pdf
ls -la "$FX"
