import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { getTool } from "@cn/engine/registry";
import type { Processor } from "./app";
import { planFor, type Step } from "./commands";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  csv: "text/csv;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  jpg: "image/jpeg",
  png: "image/png",
  zip: "application/zip",
};

function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name || "file";
}

/** True when the file starts with the ZIP signature "PK". */
async function isZip(path: string): Promise<boolean> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await fh.read({ buffer: buf, position: 0 });
    return bytesRead === 2 && buf[0] === 0x50 && buf[1] === 0x4b;
  } finally {
    await fh.close();
  }
}

async function outputExt(toolTo: string, path: string): Promise<string> {
  // Page renders come back as one image, or a ZIP when there are several pages.
  if ((toolTo === "jpg" || toolTo === "png") && (await isZip(path))) return "zip";
  return toolTo;
}

function downloadName(toolId: string, first: string, ext: string): string {
  if (toolId === "merge-pdf") return "merged.pdf";
  const base = baseName(first);
  if (ext === "zip") return toolId === "split-pdf" ? `${base}-pages.zip` : `${base}-images.zip`;
  return `${base}.${ext}`;
}

export function createProcessor(run: (steps: Step[], workDir: string) => Promise<void>): Processor {
  return async (job, inputs, options, names) => {
    const tool = getTool(job.tool);
    if (!tool) throw new Error("unknown tool");
    await mkdir(join(job.dir, "out"), { recursive: true });
    await mkdir(join(job.dir, "pages"), { recursive: true });

    const plan = planFor({ tool: job.tool, inputs, workDir: job.dir, options });
    await run(plan.steps, job.dir);

    const info = await stat(plan.output).catch(() => null);
    if (!info || info.size === 0) throw new Error("no output");
    const ext = await outputExt(tool.to, plan.output);
    return { path: plan.output, name: downloadName(tool.id, names[0] ?? "file", ext), mime: MIME[ext] ?? "application/octet-stream" };
  };
}
