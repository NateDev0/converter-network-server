import { TOOLS } from "@cn/engine/registry";
import { describe, expect, it } from "vitest";
import { planFor, type PlanInput } from "./commands";

const input = (tool: string, files = ["in-1.pdf"], options = {}): PlanInput => ({
  tool,
  inputs: files.map((f) => `/w/job/${f}`),
  workDir: "/w/job",
  options,
});

describe("conversion plans", () => {
  it("has a plan for every Site 1 tool", () => {
    for (const tool of TOOLS.filter((t) => t.site === "s1-docs")) {
      const files = tool.multiFile ? [`in-1.${tool.from[0]}`, `in-2.${tool.from[0]}`] : [`in-1.${tool.from[0]}`];
      const options = { "protect-pdf": { password: "pw" }, "unlock-pdf": { password: "pw" }, "extract-pdf-pages": { pages: "1" }, "delete-pdf-pages": { pages: "1" }, "reorder-pdf-pages": { order: [2, 1] } }[tool.id] ?? {};
      const plan = planFor(input(tool.id, files, options));
      expect(plan.steps.length, tool.id).toBeGreaterThan(0);
      expect(plan.output, tool.id).toMatch(new RegExp(`\\.${tool.to}$`));
    }
  });

  it("runs LibreOffice headless with a private profile per job", () => {
    const { steps, output } = planFor(input("word-to-pdf", ["in-1.docx"]));
    expect(steps[0]!.cmd).toBe("soffice");
    expect(steps[0]!.args).toEqual(expect.arrayContaining(["--headless", "--convert-to", "pdf", "--outdir", "/w/job/out", "/w/job/in-1.docx"]));
    expect(steps[0]!.args).toContain("-env:UserInstallation=file:///w/job/lo-profile");
    expect(output).toBe("/w/job/out/in-1.pdf");
  });

  it("converts PDF to Word with pdf2docx for editable paragraphs and tables", () => {
    const { steps, output } = planFor(input("pdf-to-word"));
    expect(steps[0]!.cmd).toBe("/opt/venv/bin/python");
    expect(steps[0]!.args).toEqual(["/app/scripts/pdf_to_docx.py", "/w/job/in-1.pdf", "/w/job/out/document.docx"]);
    expect(output).toBe("/w/job/out/document.docx");
  });

  it("compresses with Ghostscript's ebook preset", () => {
    const { steps } = planFor(input("compress-pdf"));
    expect(steps[0]!.cmd).toBe("gs");
    expect(steps[0]!.args).toEqual(expect.arrayContaining(["-sDEVICE=pdfwrite", "-dPDFSETTINGS=/ebook", "-dSAFER", "-dNOPAUSE", "-dBATCH"]));
  });

  it("OCRs without redoing pages that already have text", () => {
    const { steps } = planFor(input("ocr-pdf"));
    expect(steps[0]!.cmd).toBe("ocrmypdf");
    expect(steps[0]!.args).toContain("--skip-text");
  });

  it("encrypts with AES-256 via qpdf and requires a password", () => {
    const { steps } = planFor(input("protect-pdf", ["in-1.pdf"], { password: "s3cret" }));
    expect(steps[0]!.cmd).toBe("qpdf");
    expect(steps[0]!.args.slice(0, 5)).toEqual(["--encrypt", "s3cret", "s3cret", "256", "--"]);
    expect(() => planFor(input("protect-pdf"))).toThrow(/password/i);
  });

  it("merges multiple PDFs in upload order", () => {
    const { steps } = planFor(input("merge-pdf", ["in-1.pdf", "in-2.pdf"]));
    expect(steps[0]!.args).toEqual(["--empty", "--pages", "/w/job/in-1.pdf", "/w/job/in-2.pdf", "--", "/w/job/out/merged.pdf"]);
  });

  it("never passes user text where it could become a flag", () => {
    expect(() => planFor(input("protect-pdf", ["in-1.pdf"], { password: "--overlay" }))).toThrow(/password/i);
    expect(() => planFor(input("extract-pdf-pages", ["in-1.pdf"], { pages: "1;rm -rf /" }))).toThrow(/page/i);
  });

  it("rejects unknown tools", () => {
    expect(() => planFor(input("pdf-to-banana"))).toThrow(/unknown/i);
  });
});
