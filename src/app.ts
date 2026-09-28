import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { getTool } from "@cn/engine/registry";
import { verifyToken } from "@cn/tokens";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { PlanInput } from "./commands";
import type { Job, JobStore } from "./store";

export interface ProcessResult {
  path: string;
  name: string;
  mime: string;
}

/** Converts a job's inputs. `names` are the user's original file names: use them for the output name only, never log them. */
export type Processor = (job: Job, inputs: string[], options: PlanInput["options"], names: string[]) => Promise<ProcessResult>;

export interface AppDeps {
  store: JobStore;
  process: Processor;
  downloadSecret: string;
  /** Bearer token the API Worker uses for privileged calls (delete on refund). */
  serverToken: string;
  allowedOrigins: string[];
  /** Receives one JSON line per event. Must never be given file names or contents. */
  log: (line: string) => void;
  now?: () => number;
  concurrency?: number;
  /** Public repository with this server's source (AGPL section 13). */
  sourceUrl?: string;
  /** Test hook: overrides every tool's server size limit. */
  maxBytesOverride?: number;
}

const SOURCE_URL = "https://github.com/NateDev0/converter-network-server";
const FAILED = "We couldn't convert this file. You haven't been charged.";

function sizeBucket(bytes: number): string {
  if (bytes < 1 << 20) return "<1MB";
  if (bytes < 10 << 20) return "1-10MB";
  if (bytes < 50 << 20) return "10-50MB";
  return ">50MB";
}

/** RFC 6266 filename: ASCII fallback plus UTF-8 version. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createApp(deps: AppDeps) {
  const { store, downloadSecret, serverToken, allowedOrigins, now = Date.now, concurrency = 2 } = deps;
  const log = (event: string, fields: Record<string, string | number> = {}) => deps.log(JSON.stringify({ t: new Date(now()).toISOString(), event, ...fields }));
  const names = new Map<string, string[]>(); // jobId -> original names, memory only

  // Small in-process queue so a burst of uploads can't start 50 LibreOffice instances.
  const queue: (() => Promise<void>)[] = [];
  let running = 0;
  const pump = () => {
    while (running < concurrency && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      void task().finally(() => {
        running--;
        pump();
      });
    }
  };

  async function run(job: Job, inputs: string[], options: PlanInput["options"]) {
    const started = now();
    store.update(job.id, { status: "running", progress: 0.1 });
    try {
      const result = await deps.process(job, inputs, options, names.get(job.id) ?? []);
      const { size } = await stat(result.path);
      store.update(job.id, { status: "done", progress: 1, output: { ...result, size } });
      log("job_done", { job: job.id, tool: job.tool, ms: now() - started, out: sizeBucket(size) });
    } catch {
      // The error text can contain paths or document text, so it is deliberately not logged.
      // Delete first, so "failed" always means the files are already gone.
      names.delete(job.id);
      await store.clearFiles(job.id);
      store.update(job.id, { status: "failed", error: FAILED });
      log("job_failed", { job: job.id, tool: job.tool, ms: now() - started });
    }
  }

  const app = new Hono();

  app.use("*", cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "DELETE"],
    // The site names the downloaded file from this header, so it must be readable cross-origin.
    exposeHeaders: ["Content-Disposition", "Content-Length"],
    maxAge: 600,
  }));

  app.get("/source", (c) => c.json({ license: "AGPL-3.0-or-later", source: deps.sourceUrl ?? SOURCE_URL }));

  app.get("/health", (c) => c.json({ ok: true, jobs: store.size, queued: queue.length, running }));

  app.post("/jobs", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "Send the file as multipart/form-data." }, 400);
    }
    const tool = getTool(String(form.get("tool") ?? ""));
    if (!tool || !tool.engines.includes("server")) return c.json({ error: "Unknown tool." }, 400);

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return c.json({ error: "Choose a file first." }, 400);
    if (files.length > 1 && !tool.multiFile) return c.json({ error: "This tool works on one file at a time." }, 400);
    if (files.length > 50) return c.json({ error: "Up to 50 files at once." }, 400);

    const exts = files.map((f) => extname(f.name).slice(1).toLowerCase());
    if (exts.some((e) => !tool.from.includes(e))) return c.json({ error: `This tool accepts ${tool.from.join(", ").toUpperCase()} files.` }, 415);

    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > (deps.maxBytesOverride ?? tool.limits.serverBytes)) return c.json({ error: "This file is too large." }, 413);

    let options: PlanInput["options"] = {};
    const rawOptions = form.get("options");
    if (typeof rawOptions === "string" && rawOptions !== "") {
      try {
        options = JSON.parse(rawOptions) as PlanInput["options"];
      } catch {
        return c.json({ error: "Invalid options." }, 400);
      }
    }

    const job = await store.create(tool.id);
    // Files are stored under names we choose, so user input never reaches a path or a command line.
    const inputs = await Promise.all(files.map(async (f, i) => {
      const path = join(job.dir, `in-${i + 1}.${exts[i]}`);
      await writeFile(path, new Uint8Array(await f.arrayBuffer()), { mode: 0o600 });
      return path;
    }));
    names.set(job.id, files.map((f) => f.name));
    log("job_created", { job: job.id, tool: tool.id, files: files.length, in: sizeBucket(total) });

    queue.push(() => run(job, inputs, options));
    pump();
    return c.json({ jobId: job.id, expiresAt: job.expiresAt }, 202);
  });

  app.get("/jobs/:id", (c) => {
    const job = store.get(c.req.param("id"));
    if (!job) return c.json({ error: "Not found." }, 404);
    return c.json({
      status: job.status,
      progress: job.progress,
      expiresAt: job.expiresAt,
      ...(job.error ? { error: job.error } : {}),
      ...(job.output ? { outputName: job.output.name, outputSize: job.output.size } : {}),
    });
  });

  app.get("/jobs/:id/file", async (c) => {
    const id = c.req.param("id");
    const job = store.get(id);
    if (!job) return c.json({ error: "This file has been deleted." }, 404);
    const token = c.req.query("token");
    if (!token) return c.json({ error: "Payment required." }, 401);
    const claims = await verifyToken(token, downloadSecret, now());
    if (!claims || claims.jobId !== id) return c.json({ error: "This download link isn't valid." }, 403);
    if (job.status !== "done" || !job.output) return c.json({ error: "Not ready yet." }, 409);

    const { path, name, mime, size } = job.output;
    const cleanup = new TransformStream<Uint8Array, Uint8Array>({
      async flush() {
        // Fully sent: delete now rather than waiting for expiry.
        names.delete(id);
        await store.remove(id);
        log("job_downloaded", { job: id, tool: job.tool });
      },
    });
    const body = (Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>).pipeThrough(cleanup);
    return new Response(body, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(size),
        "Content-Disposition": disposition(name),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.delete("/jobs/:id", async (c) => {
    if (c.req.header("Authorization") !== `Bearer ${serverToken}`) return c.json({ error: "Unauthorized." }, 401);
    const id = c.req.param("id");
    names.delete(id);
    await store.remove(id);
    log("job_deleted", { job: id });
    return c.body(null, 204);
  });

  return app;
}
