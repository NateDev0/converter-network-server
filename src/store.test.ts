import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobStore } from "./store";

let root: string;
let clock: number;
let store: JobStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cn-store-"));
  clock = 1_000_000;
  store = new JobStore({ root, ttlMs: 15 * 60_000, now: () => clock });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("JobStore", () => {
  it("creates a job with its own working folder", async () => {
    const job = await store.create("pdf-to-word");
    expect(job).toMatchObject({ tool: "pdf-to-word", status: "queued", progress: 0, expiresAt: clock + 15 * 60_000 });
    expect(existsSync(job.dir)).toBe(true);
    expect(store.get(job.id)).toBe(job);
  });

  it("uses long random ids", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add((await store.create("merge-pdf")).id);
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("removes the folder and forgets the job", async () => {
    const job = await store.create("merge-pdf");
    await store.remove(job.id);
    expect(existsSync(job.dir)).toBe(false);
    expect(store.get(job.id)).toBeUndefined();
  });

  it("sweeps only expired jobs", async () => {
    const old = await store.create("merge-pdf");
    clock += 10 * 60_000;
    const fresh = await store.create("merge-pdf");
    clock += 6 * 60_000;
    expect(await store.sweep()).toBe(1);
    expect(existsSync(old.dir)).toBe(false);
    expect(store.get(old.id)).toBeUndefined();
    expect(store.get(fresh.id)).toBeDefined();
  });

  it("also clears folders it doesn't know about (e.g. after a crash)", async () => {
    const { mkdir } = await import("node:fs/promises");
    const stray = join(root, "00000000-0000-4000-8000-000000000000");
    await mkdir(stray);
    await store.sweep();
    expect(existsSync(stray)).toBe(false);
  });

  it("refuses ids that could escape the root folder", () => {
    expect(store.get("../../etc")).toBeUndefined();
  });
});
