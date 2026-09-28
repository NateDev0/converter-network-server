# converter-network-server

The file-conversion server behind PDF Canary and its sister sites. Published under the
**GNU AGPL v3 or later** because it uses [PyMuPDF](https://github.com/pymupdf/PyMuPDF) (AGPL) through
[pdf2docx](https://github.com/ArtifexSoftware/pdf2docx). This repository is the complete source of the
server as deployed.

## What it does

`POST /jobs` accepts an upload for a named tool, `GET /jobs/:id` reports progress, and
`GET /jobs/:id/file?token=` streams the result once to a holder of a signed download token, then deletes it.
`GET /source` links here.

Files are named by the server (`in-1.pdf`), kept in RAM (`/dev/shm`), never logged, and deleted after download,
on failure, on refund, or 15 minutes after upload.

## Engines

LibreOffice, qpdf, Ghostscript, OCRmyPDF/Tesseract, Poppler, img2pdf, pdf2docx/PyMuPDF, pdfplumber, openpyxl,
python-pptx. See each project's license.

## Run

```sh
docker build -t convert-server .
docker run -p 8080:8080 --shm-size=1g \
  -e DOWNLOAD_TOKEN_SECRET=... -e CONVERT_SERVER_TOKEN=... -e ALLOWED_ORIGINS=https://example.com \
  convert-server
```

## Develop

```sh
npm install
npm test       # unit tests (integration tests run inside the Docker image in the private monorepo's CI)
npm run build
```
