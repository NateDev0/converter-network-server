import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signToken } from "@cn/tokens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type Processor } from "./app";
import { JobStore } from "./store";

const SECRET = "download-secret-that-is-at-least-32-chars";
const SERVER_TOKEN = "server-token-for-the-api-worker";
const ORIGIN = "https://pdfcanary.com";
const SECRET_NAME = "tax-return-2026-private.pdf";

let root: string;
let clock: number;
let store: JobStore;
let logs: string[];
let processor: Processor;

function makeApp() {
  return createApp({
    store,
    process: (...args) => processor(...args),
    downloadSecret: SECRET,
    serverToken: SERVER_TOKEN,
    allowedOrigins: [ORIGIN],
    log: (line) => logs.push(line),
    now: () => clock,
  });
}

function upload(app: ReturnType<typeof createApp>, tool: string, files: { name: string; body: string }[], options?: object) {
  const form = new FormData();
  form.set("tool", tool);
  for (const f of files) form.append("files", new File([f.body], f.name));
  if (options) form.set("options", JSON.stringify(options));
  return app.request("/jobs", { method: "POST", body: form, headers: { Origin: ORIGIN } });
}

async function until(app: ReturnType<typeof createApp>, id: string, status: string): Promise<{ status: string; error?: string; [k: string]: unknown }> {
  for (let i = 0; i < 50; i++) {
    const res = await app.request(`/jobs/${id}`);
    const body = (await res.json()) as { status: string; error?: string };
    if (body.status === status) return body;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`job never reached ${status}`);
}

async function tokenFor(jobId: string, expInSeconds = 900) {
  return signToken({ jobId, exp: Math.floor(clock / 1000) + expInSeconds, pi: "pi_test" }, SECRET);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cn-app-"));
  clock = Date.now();
  store = new JobStore({ root, ttlMs: 15 * 60_000, now: () => clock });
  logs = [];
  processor = async (job) => {
    const path = join(job.dir, "out.docx");
    await writeFile(path, "converted-bytes");
    return { path, name: "tax-return-2026-private.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  };
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("POST /jobs", () => {
  it("accepts a valid upload and converts it", async () => {
    const app = makeApp();
    const res = await upload(app, "pdf-to-word", [{ name: SECRET_NAME, body: "%PDF-1.7 fake" }]);
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(await until(app, jobId, "done")).toMatchObject({ status: "done", progress: 1, outputName: "tax-return-2026-private.docx", outputSize: 15 });
  });

  it("rejects unknown tools", async () => {
    expect((await upload(makeApp(), "pdf-to-banana", [{ name: "a.pdf", body: "x" }])).status).toBe(400);
  });

  it("rejects the wrong file type", async () => {
    expect((await upload(makeApp(), "pdf-to-word", [{ name: "photo.png", body: "x" }])).status).toBe(415);
  });

  it("rejects a request with no files", async () => {
    expect((await upload(makeApp(), "pdf-to-word", [])).status).toBe(400);
  });

  it("rejects several files for a single-file tool", async () => {
    expect((await upload(makeApp(), "pdf-to-word", [{ name: "a.pdf", body: "x" }, { name: "b.pdf", body: "y" }])).status).toBe(400);
  });

  it("rejects files over the tool's server limit", async () => {
    const app = createApp({
      store, process: processor, downloadSecret: SECRET, serverToken: SERVER_TOKEN, allowedOrigins: [ORIGIN], log: () => {}, now: () => clock,
      maxBytesOverride: 10,
    });
    expect((await upload(app, "pdf-to-word", [{ name: "a.pdf", body: "more than ten bytes" }])).status).toBe(413);
  });

  it("marks the job failed with a friendly message and deletes its files", async () => {
    processor = async () => {
      throw new Error(`soffice crashed on /dev/shm/jobs/${SECRET_NAME}`);
    };
    const app = makeApp();
    const { jobId } = (await (await upload(app, "pdf-to-word", [{ name: SECRET_NAME, body: "x" }])).json()) as { jobId: string };
    const body = await until(app, jobId, "failed");
    expect(body.error).toBe("We couldn't convert this file. You haven't been charged.");
    expect(existsSync(join(root, jobId))).toBe(false);
  });
});

describe("GET /jobs/:id/file", () => {
  async function doneJob(app: ReturnType<typeof createApp>) {
    const { jobId } = (await (await upload(app, "pdf-to-word", [{ name: SECRET_NAME, body: "x" }])).json()) as { jobId: string };
    await until(app, jobId, "done");
    return jobId;
  }

  it("needs a download token", async () => {
    const app = makeApp();
    expect((await app.request(`/jobs/${await doneJob(app)}/file`)).status).toBe(401);
  });

  it("rejects a token for a different job", async () => {
    const app = makeApp();
    const id = await doneJob(app);
    expect((await app.request(`/jobs/${id}/file?token=${await tokenFor("someone-else")}`)).status).toBe(403);
  });

  it("rejects an expired token", async () => {
    const app = makeApp();
    const id = await doneJob(app);
    expect((await app.request(`/jobs/${id}/file?token=${await tokenFor(id, -1)}`)).status).toBe(403);
  });

  it("streams the file once, then deletes it", async () => {
    const app = makeApp();
    const id = await doneJob(app);
    const token = await tokenFor(id);
    const res = await app.request(`/jobs/${id}/file?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="tax-return-2026-private.docx"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("converted-bytes");
    expect(existsSync(join(root, id))).toBe(false);
    expect((await app.request(`/jobs/${id}/file?token=${token}`)).status).toBe(404);
    expect((await app.request(`/jobs/${id}`)).status).toBe(404);
  });

  it("returns 409 while the job is still running", async () => {
    let release!: () => void;
    processor = (job) => new Promise((resolve) => { release = () => resolve({ path: join(job.dir, "x"), name: "x.docx", mime: "x" }); });
    const app = makeApp();
    const { jobId } = (await (await upload(app, "pdf-to-word", [{ name: "a.pdf", body: "x" }])).json()) as { jobId: string };
    expect((await app.request(`/jobs/${jobId}/file?token=${await tokenFor(jobId)}`)).status).toBe(409);
    release();
    // Let the job settle before the temp folder is removed (Windows refuses to delete busy folders).
    await until(app, jobId, "failed");
  });
});

describe("DELETE /jobs/:id", () => {
  it("requires the server token and deletes the files", async () => {
    const app = makeApp();
    const { jobId } = (await (await upload(app, "pdf-to-word", [{ name: "a.pdf", body: "x" }])).json()) as { jobId: string };
    await until(app, jobId, "done");
    expect((await app.request(`/jobs/${jobId}`, { method: "DELETE" })).status).toBe(401);
    const res = await app.request(`/jobs/${jobId}`, { method: "DELETE", headers: { Authorization: `Bearer ${SERVER_TOKEN}` } });
    expect(res.status).toBe(204);
    expect(existsSync(join(root, jobId))).toBe(false);
  });
});

describe("GET /source", () => {
  it("offers this server's source code, as the AGPL requires", async () => {
    const res = await makeApp().request("/source");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ license: "AGPL-3.0-or-later", source: "https://github.com/NateDev0/converter-network-server" });
  });
});

describe("privacy", () => {
  it("never logs file names or contents", async () => {
    const app = makeApp();
    const { jobId } = (await (await upload(app, "pdf-to-word", [{ name: SECRET_NAME, body: "SSN 123-45-6789" }])).json()) as { jobId: string };
    await until(app, jobId, "done");
    await app.request(`/jobs/${jobId}/file?token=${await tokenFor(jobId)}`);
    const all = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(all).not.toContain("tax-return");
    expect(all).not.toContain("123-45-6789");
  });

  it("only allows our own sites to call it from a browser", async () => {
    const app = makeApp();
    const ok = await app.request("/health", { headers: { Origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await app.request("/health", { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});
