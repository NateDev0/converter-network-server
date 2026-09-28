export type SiteId = "s1-docs" | "s2-images" | "s3-media" | "s4-files";
export type EngineKind = "browser" | "server";
export type ToolCategory = "from-pdf" | "to-pdf" | "organize" | "optimize" | "office";

export interface ToolDef {
  /** URL slug, e.g. "pdf-to-word". */
  id: string;
  site: SiteId;
  /** "convert" = format pair page, "tool" = an operation like merge or compress. */
  kind: "convert" | "tool";
  category: ToolCategory;
  title: string;
  /** Accepted input extensions, lower case, no dot. */
  from: string[];
  /** Output extension. */
  to: string;
  /** Engines in preference order. Every tool keeps a server fallback. */
  engines: EngineKind[];
  limits: { browserBytes?: number; serverBytes: number };
  /** Browser cost in ms per MB on a reference device (score 1). Only for browser-capable tools. */
  costMsPerMb?: number;
  multiFile?: boolean;
  /** Sample file under fixtures/ used by the round-trip tests. */
  fixture: string;
}

const MB = 1024 * 1024;
const WORD = ["docx", "doc"];
const EXCEL = ["xlsx", "xls"];
const POWERPOINT = ["pptx", "ppt"];
const IMAGES = ["jpg", "jpeg", "png", "webp"];

type Draft = Omit<ToolDef, "site" | "engines" | "limits" | "costMsPerMb"> &
  ({ browser: { maxMb: number; costMsPerMb: number }; serverMb?: number } | { browser?: undefined; serverMb?: number });

function s1(d: Draft): ToolDef {
  const serverBytes = (d.serverMb ?? 100) * MB;
  const { browser, serverMb: _serverMb, ...rest } = d;
  if (!browser) return { ...rest, site: "s1-docs", engines: ["server"], limits: { serverBytes } };
  return {
    ...rest,
    site: "s1-docs",
    engines: ["browser", "server"],
    limits: { browserBytes: browser.maxMb * MB, serverBytes },
    costMsPerMb: browser.costMsPerMb,
  };
}

const pdfLib = { maxMb: 200, costMsPerMb: 50 };
const pdfRender = { maxMb: 100, costMsPerMb: 600 };
const imageToPdf = { maxMb: 100, costMsPerMb: 60 };
const sheet = { maxMb: 50, costMsPerMb: 250 };

export const TOOLS: readonly ToolDef[] = [
  // Convert from PDF
  s1({ id: "pdf-to-word", kind: "convert", category: "from-pdf", title: "PDF to Word", from: ["pdf"], to: "docx", fixture: "sample.pdf" }),
  s1({ id: "pdf-to-excel", kind: "convert", category: "from-pdf", title: "PDF to Excel", from: ["pdf"], to: "xlsx", fixture: "sample-table.pdf" }),
  s1({ id: "pdf-to-powerpoint", kind: "convert", category: "from-pdf", title: "PDF to PowerPoint", from: ["pdf"], to: "pptx", fixture: "sample.pdf" }),
  s1({ id: "pdf-to-jpg", kind: "convert", category: "from-pdf", title: "PDF to JPG", from: ["pdf"], to: "jpg", browser: pdfRender, fixture: "sample.pdf" }),
  s1({ id: "pdf-to-png", kind: "convert", category: "from-pdf", title: "PDF to PNG", from: ["pdf"], to: "png", browser: pdfRender, fixture: "sample.pdf" }),
  s1({ id: "pdf-to-text", kind: "convert", category: "from-pdf", title: "PDF to Text", from: ["pdf"], to: "txt", browser: { maxMb: 100, costMsPerMb: 300 }, fixture: "sample.pdf" }),
  s1({ id: "pdf-to-images", kind: "tool", category: "from-pdf", title: "PDF to images (ZIP)", from: ["pdf"], to: "zip", browser: pdfRender, fixture: "sample.pdf" }),

  // Convert to PDF
  s1({ id: "word-to-pdf", kind: "convert", category: "to-pdf", title: "Word to PDF", from: WORD, to: "pdf", fixture: "sample.docx" }),
  s1({ id: "excel-to-pdf", kind: "convert", category: "to-pdf", title: "Excel to PDF", from: EXCEL, to: "pdf", fixture: "sample.xlsx" }),
  s1({ id: "powerpoint-to-pdf", kind: "convert", category: "to-pdf", title: "PowerPoint to PDF", from: POWERPOINT, to: "pdf", fixture: "sample.pptx" }),
  s1({ id: "jpg-to-pdf", kind: "convert", category: "to-pdf", title: "JPG to PDF", from: ["jpg", "jpeg"], to: "pdf", browser: imageToPdf, multiFile: true, fixture: "sample.jpg" }),
  s1({ id: "png-to-pdf", kind: "convert", category: "to-pdf", title: "PNG to PDF", from: ["png"], to: "pdf", browser: imageToPdf, multiFile: true, fixture: "sample.png" }),
  s1({ id: "text-to-pdf", kind: "convert", category: "to-pdf", title: "Text to PDF", from: ["txt"], to: "pdf", browser: { maxMb: 20, costMsPerMb: 150 }, fixture: "sample.txt" }),
  s1({ id: "html-to-pdf", kind: "convert", category: "to-pdf", title: "HTML to PDF", from: ["html", "htm"], to: "pdf", serverMb: 20, fixture: "sample.html" }),
  s1({ id: "images-to-pdf", kind: "tool", category: "to-pdf", title: "Images to PDF", from: IMAGES, to: "pdf", browser: imageToPdf, multiFile: true, fixture: "sample.jpg" }),

  // Office formats
  s1({ id: "rtf-to-word", kind: "convert", category: "office", title: "RTF to Word", from: ["rtf"], to: "docx", fixture: "sample.rtf" }),
  s1({ id: "word-to-rtf", kind: "convert", category: "office", title: "Word to RTF", from: WORD, to: "rtf", fixture: "sample.docx" }),
  s1({ id: "odt-to-word", kind: "convert", category: "office", title: "ODT to Word", from: ["odt"], to: "docx", fixture: "sample.odt" }),
  s1({ id: "word-to-odt", kind: "convert", category: "office", title: "Word to ODT", from: WORD, to: "odt", fixture: "sample.docx" }),
  s1({ id: "csv-to-excel", kind: "convert", category: "office", title: "CSV to Excel", from: ["csv"], to: "xlsx", browser: sheet, fixture: "sample.csv" }),
  s1({ id: "excel-to-csv", kind: "convert", category: "office", title: "Excel to CSV", from: EXCEL, to: "csv", browser: sheet, fixture: "sample.xlsx" }),

  // Organize
  s1({ id: "merge-pdf", kind: "tool", category: "organize", title: "Merge PDF", from: ["pdf"], to: "pdf", browser: pdfLib, serverMb: 200, multiFile: true, fixture: "sample.pdf" }),
  s1({ id: "split-pdf", kind: "tool", category: "organize", title: "Split PDF", from: ["pdf"], to: "zip", browser: pdfLib, serverMb: 200, fixture: "sample.pdf" }),
  s1({ id: "rotate-pdf", kind: "tool", category: "organize", title: "Rotate PDF", from: ["pdf"], to: "pdf", browser: pdfLib, serverMb: 200, fixture: "sample.pdf" }),
  s1({ id: "extract-pdf-pages", kind: "tool", category: "organize", title: "Extract PDF pages", from: ["pdf"], to: "pdf", browser: pdfLib, serverMb: 200, fixture: "sample.pdf" }),
  s1({ id: "delete-pdf-pages", kind: "tool", category: "organize", title: "Delete PDF pages", from: ["pdf"], to: "pdf", browser: pdfLib, serverMb: 200, fixture: "sample.pdf" }),
  s1({ id: "reorder-pdf-pages", kind: "tool", category: "organize", title: "Reorder PDF pages", from: ["pdf"], to: "pdf", browser: pdfLib, serverMb: 200, fixture: "sample.pdf" }),

  // Optimize & secure
  s1({ id: "compress-pdf", kind: "tool", category: "optimize", title: "Compress PDF", from: ["pdf"], to: "pdf", serverMb: 200, fixture: "sample.pdf" }),
  s1({ id: "ocr-pdf", kind: "tool", category: "optimize", title: "OCR PDF (make searchable)", from: ["pdf"], to: "pdf", serverMb: 100, fixture: "sample-scanned.pdf" }),
  s1({ id: "protect-pdf", kind: "tool", category: "optimize", title: "Protect PDF", from: ["pdf"], to: "pdf", fixture: "sample.pdf" }),
  s1({ id: "unlock-pdf", kind: "tool", category: "optimize", title: "Unlock PDF", from: ["pdf"], to: "pdf", fixture: "sample-protected.pdf" }),
];

const byId = new Map(TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): ToolDef | undefined {
  return byId.get(id);
}

export function toolsForSite(site: SiteId): ToolDef[] {
  return TOOLS.filter((t) => t.site === site);
}
