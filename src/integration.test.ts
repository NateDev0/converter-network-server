import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { toolsForSite } from "@cn/engine/registry";
import { describe, expect, it } from "vitest";
import { createProcessor } from "./processor";
import { runSteps } from "./runner";
import { JobStore } from "./store";

// Runs inside the Docker test stage only: `docker build --target test`.
const FIXTURES = process.env.FIXTURES;
const run = process.env.CONVERT_INTEGRATION === "1" && FIXTURES ? describe : describe.skip;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  pdf: (b) => b.subarray(0, 4).toString() === "%PDF",
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  png: (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG",
  rtf: (b) => b.subarray(0, 5).toString() === String.raw`{\rtf`,
  txt: (b) => b.length > 0,
  csv: (b) => b.toString().includes("Widget"),
};
MAGIC.docx = MAGIC.xlsx = MAGIC.pptx = MAGIC.odt = MAGIC.zip!;

const OPTIONS: Record<string, object> = {
  "protect-pdf": { password: "pw" },
  "unlock-pdf": { password: "pw" },
  "extract-pdf-pages": { pages: "1" },
  "delete-pdf-pages": { pages: "1" },
  "reorder-pdf-pages": { order: [2, 1] },
};

run("real conversions (Docker)", () => {
  const process = createProcessor(runSteps);

  it.each(toolsForSite("s1-docs").map((t) => [t.id, t] as const))("%s", async (_id, tool) => {
    const root = await mkdtemp(join(tmpdir(), "cn-int-"));
    try {
      const store = new JobStore({ root });
      const job = await store.create(tool.id);
      const count = tool.multiFile ? 2 : 1;
      const inputs: string[] = [];
      for (let i = 1; i <= count; i++) {
        const path = join(job.dir, `in-${i}${extname(tool.fixture)}`);
        await copyFile(join(FIXTURES!, tool.fixture), path);
        inputs.push(path);
      }
      const result = await process(job, inputs, OPTIONS[tool.id] ?? {}, [tool.fixture]);
      const bytes = await readFile(result.path);
      const ext = extname(result.name).slice(1);
      expect(bytes.length).toBeGreaterThan(0);
      expect(MAGIC[ext]?.(bytes), `${tool.id} produced a valid .${ext}; starts with ${JSON.stringify(bytes.subarray(0, 24).toString("latin1"))}`).toBe(true);
      if (tool.id === "pdf-to-text") expect(bytes.toString()).toContain("Quarterly revenue");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
