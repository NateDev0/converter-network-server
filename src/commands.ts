// The server only runs on Linux, so build POSIX paths even when tests run elsewhere.
import { basename, extname, join } from "node:path/posix";

export interface PlanInput {
  tool: string;
  /** Absolute paths of the uploaded files, in upload order. Named by us (in-1.pdf), never by the user. */
  inputs: string[];
  workDir: string;
  options: { password?: string; pages?: string; degrees?: number; order?: number[] };
}

export interface Step {
  cmd: string;
  args: string[];
  /** Kill the step after this long. */
  timeoutMs?: number;
}

export interface Plan {
  steps: Step[];
  /** Path of the finished file. */
  output: string;
}

const MINUTE = 60_000;
const PY = "/opt/venv/bin/python";
const SCRIPTS = "/app/scripts";

function first(p: PlanInput): string {
  const f = p.inputs[0];
  if (!f) throw new Error("No input file.");
  return f;
}

function stem(path: string): string {
  return basename(path, extname(path));
}

function out(p: PlanInput, name: string): string {
  return join(p.workDir, "out", name);
}

function password(p: PlanInput): string {
  const pw = p.options.password ?? "";
  // Printable ASCII only, and never something qpdf could read as a flag.
  if (!/^[\x20-\x7e]{1,128}$/.test(pw) || pw.startsWith("-")) throw new Error("Choose a password of 1-128 regular characters that doesn't start with '-'.");
  return pw;
}

function pages(p: PlanInput): string {
  const s = (p.options.pages ?? "").replace(/\s+/g, "");
  if (!/^\d+(-\d*)?(,\d+(-\d*)?)*$/.test(s)) throw new Error('Enter page numbers like "1-3,5".');
  // qpdf uses "z" for the last page.
  return s.replace(/-(?=,|$)/g, "-z");
}

function soffice(p: PlanInput, to: string, filter?: string): Plan {
  const input = first(p);
  const target = filter ? `${to}:${filter}` : to;
  return {
    steps: [
      {
        cmd: "soffice",
        args: [
          // A private profile per job lets several conversions run at once.
          `-env:UserInstallation=file://${join(p.workDir, "lo-profile")}`,
          "--headless", "--norestore", "--nolockcheck",
          ...(input.endsWith(".pdf") ? ["--infilter=writer_pdf_import"] : []),
          "--convert-to", target, "--outdir", join(p.workDir, "out"), input,
        ],
        timeoutMs: 3 * MINUTE,
      },
    ],
    output: out(p, `${stem(input)}.${to}`),
  };
}

function qpdf(p: PlanInput, args: string[], name = "out.pdf"): Plan {
  return { steps: [{ cmd: "qpdf", args: [...args, out(p, name)], timeoutMs: MINUTE }], output: out(p, name) };
}

function pdftoppm(p: PlanInput, format: "jpeg" | "png", zip: boolean): Plan {
  const input = first(p);
  const ext = format === "jpeg" ? "jpg" : "png";
  const prefix = join(p.workDir, "pages", "page");
  const render: Step = { cmd: "pdftoppm", args: [`-${format}`, "-r", "150", input, prefix], timeoutMs: 3 * MINUTE };
  // One page -> the image itself; several (or zip requested) -> a ZIP. The helper decides.
  return {
    steps: [render, { cmd: PY, args: [`${SCRIPTS}/collect_pages.py`, join(p.workDir, "pages"), out(p, zip ? "pages.zip" : `pages.${ext}`), ext, zip ? "zip" : "auto"] }],
    output: out(p, zip ? "pages.zip" : `pages.${ext}`),
  };
}

type Builder = (p: PlanInput) => Plan;

const PLANS: Record<string, Builder> = {
  // Office via LibreOffice
  "word-to-pdf": (p) => soffice(p, "pdf"),
  "excel-to-pdf": (p) => soffice(p, "pdf"),
  "powerpoint-to-pdf": (p) => soffice(p, "pdf"),
  "html-to-pdf": (p) => soffice(p, "pdf", "writer_web_pdf_Export"),
  "text-to-pdf": (p) => soffice(p, "pdf"),
  "rtf-to-word": (p) => soffice(p, "docx", "MS Word 2007 XML"),
  "odt-to-word": (p) => soffice(p, "docx", "MS Word 2007 XML"),
  "word-to-rtf": (p) => soffice(p, "rtf", "Rich Text Format"),
  "word-to-odt": (p) => soffice(p, "odt"),
  "csv-to-excel": (p) => soffice(p, "xlsx", "Calc MS Excel 2007 XML"),
  "excel-to-csv": (p) => soffice(p, "csv", "Text - txt - csv (StarCalc):44,34,76,1"),
  // pdf2docx rebuilds flowing paragraphs and real tables (LibreOffice gives positioned text boxes).
  "pdf-to-word": (p) => ({ steps: [{ cmd: PY, args: [`${SCRIPTS}/pdf_to_docx.py`, first(p), out(p, "document.docx")], timeoutMs: 3 * MINUTE }], output: out(p, "document.docx") }),

  // Python helpers (MIT-licensed libraries)
  "pdf-to-excel": (p) => ({ steps: [{ cmd: PY, args: [`${SCRIPTS}/pdf_to_xlsx.py`, first(p), out(p, "tables.xlsx")], timeoutMs: 3 * MINUTE }], output: out(p, "tables.xlsx") }),
  "pdf-to-powerpoint": (p) => ({
    steps: [
      { cmd: "pdftoppm", args: ["-png", "-r", "150", first(p), join(p.workDir, "pages", "page")], timeoutMs: 3 * MINUTE },
      { cmd: PY, args: [`${SCRIPTS}/images_to_pptx.py`, join(p.workDir, "pages"), out(p, "slides.pptx")], timeoutMs: MINUTE },
    ],
    output: out(p, "slides.pptx"),
  }),
  "jpg-to-pdf": (p) => ({ steps: [{ cmd: "img2pdf", args: ["--output", out(p, "images.pdf"), ...p.inputs], timeoutMs: MINUTE }], output: out(p, "images.pdf") }),
  "png-to-pdf": (p) => PLANS["jpg-to-pdf"]!(p),
  "images-to-pdf": (p) => PLANS["jpg-to-pdf"]!(p),

  // Poppler
  "pdf-to-jpg": (p) => pdftoppm(p, "jpeg", false),
  "pdf-to-png": (p) => pdftoppm(p, "png", false),
  "pdf-to-images": (p) => pdftoppm(p, "jpeg", true),
  "pdf-to-text": (p) => ({ steps: [{ cmd: "pdftotext", args: ["-layout", "-enc", "UTF-8", first(p), out(p, "text.txt")], timeoutMs: MINUTE }], output: out(p, "text.txt") }),

  // qpdf
  "merge-pdf": (p) => qpdf(p, ["--empty", "--pages", ...p.inputs, "--"], "merged.pdf"),
  "split-pdf": (p) => ({
    steps: [
      { cmd: "qpdf", args: ["--split-pages", first(p), join(p.workDir, "pages", "page-%d.pdf")], timeoutMs: MINUTE },
      { cmd: PY, args: [`${SCRIPTS}/collect_pages.py`, join(p.workDir, "pages"), out(p, "pages.zip"), "pdf", "zip"] },
    ],
    output: out(p, "pages.zip"),
  }),
  "rotate-pdf": (p) => {
    const deg = p.options.degrees ?? 90;
    if (![90, 180, 270].includes(deg)) throw new Error("Rotate by 90, 180 or 270 degrees.");
    const range = p.options.pages ? pages(p) : "1-z";
    return qpdf(p, [first(p), `--rotate=+${deg}:${range}`, "--"]);
  },
  "extract-pdf-pages": (p) => qpdf(p, ["--empty", "--pages", first(p), pages(p), "--"]),
  // Debian's qpdf predates page-exclusion ranges, so deletion uses a tiny PyMuPDF script.
  "delete-pdf-pages": (p) => ({ steps: [{ cmd: PY, args: [`${SCRIPTS}/delete_pages.py`, first(p), pages(p), out(p, "out.pdf")], timeoutMs: MINUTE }], output: out(p, "out.pdf") }),
  "reorder-pdf-pages": (p) => {
    const order = p.options.order ?? [];
    if (order.length === 0 || !order.every((n) => Number.isInteger(n) && n > 0)) throw new Error("The new order must list each page exactly once.");
    return qpdf(p, ["--empty", "--pages", first(p), order.join(","), "--"]);
  },
  "protect-pdf": (p) => {
    const pw = password(p);
    return qpdf(p, ["--encrypt", pw, pw, "256", "--", first(p)]);
  },
  "unlock-pdf": (p) => qpdf(p, [`--password=${password(p)}`, "--decrypt", first(p)]),

  // Ghostscript / OCRmyPDF
  "compress-pdf": (p) => ({
    steps: [{
      cmd: "gs",
      args: ["-sDEVICE=pdfwrite", "-dPDFSETTINGS=/ebook", "-dCompatibilityLevel=1.6", "-dSAFER", "-dNOPAUSE", "-dBATCH", "-dQUIET", `-sOutputFile=${out(p, "compressed.pdf")}`, first(p)],
      timeoutMs: 3 * MINUTE,
    }],
    output: out(p, "compressed.pdf"),
  }),
  "ocr-pdf": (p) => ({
    steps: [{ cmd: "ocrmypdf", args: ["--skip-text", "--output-type", "pdf", "--jobs", "2", "-l", "eng", first(p), out(p, "searchable.pdf")], timeoutMs: 5 * MINUTE }],
    output: out(p, "searchable.pdf"),
  }),
};

export function planFor(p: PlanInput): Plan {
  const build = PLANS[p.tool];
  if (!build) throw new Error(`Unknown tool: ${p.tool}`);
  return build(p);
}

export function hasPlan(tool: string): boolean {
  return tool in PLANS;
}
