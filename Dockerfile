# PDF conversion server. AGPL-3.0-or-later. Build: docker build .
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      qpdf ghostscript ocrmypdf tesseract-ocr-eng poppler-utils img2pdf \
      python3 python3-venv \
      fonts-liberation fonts-dejavu-core fonts-noto-core fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir pdfplumber==0.11.7 openpyxl==3.1.5 python-pptx==1.0.2 pillow==11.3.0 pdf2docx==0.5.13 pymupdf==1.28.2
COPY scripts /app/scripts


FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM base AS runtime
WORKDIR /app
COPY --from=build /src/dist ./dist
# Work files live in RAM (/dev/shm); nothing is written to persistent disk.
ENV NODE_ENV=production PORT=8080 WORK_DIR=/dev/shm/jobs
EXPOSE 8080
USER node
CMD ["node", "dist/index.mjs"]
