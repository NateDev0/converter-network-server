import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobOutput {
  path: string;
  /** Download name shown to the user. Never logged. */
  name: string;
  mime: string;
  size: number;
}

export interface Job {
  id: string;
  tool: string;
  status: JobStatus;
  progress: number;
  createdAt: number;
  expiresAt: number;
  dir: string;
  output?: JobOutput;
  error?: string;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Jobs live in memory; their files live in one folder each under `root`, which should be RAM-backed
 * (/dev/shm). Nothing survives a restart, and every folder is deleted after download, on refund,
 * or when it expires.
 */
export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor({ root, ttlMs = 15 * 60_000, now = Date.now }: { root: string; ttlMs?: number; now?: () => number }) {
    this.root = root;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async create(tool: string): Promise<Job> {
    const id = randomUUID();
    const dir = join(this.root, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const created = this.now();
    const job: Job = { id, tool, status: "queued", progress: 0, createdAt: created, expiresAt: created + this.ttlMs, dir };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return ID.test(id) ? this.jobs.get(id) : undefined;
  }

  update(id: string, patch: Partial<Omit<Job, "id" | "dir">>): void {
    const job = this.get(id);
    if (job) Object.assign(job, patch);
  }

  async remove(id: string): Promise<void> {
    if (!ID.test(id)) return;
    this.jobs.delete(id);
    await rm(join(this.root, id), { recursive: true, force: true });
  }

  /** Deletes a job's files but keeps its status (used for failed jobs). */
  async clearFiles(id: string): Promise<void> {
    if (!ID.test(id)) return;
    await rm(join(this.root, id), { recursive: true, force: true });
  }

  /** Deletes expired jobs and any stray folders. Returns how many known jobs were removed. */
  async sweep(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const job of [...this.jobs.values()]) {
      if (job.expiresAt <= now) {
        await this.remove(job.id);
        removed++;
      }
    }
    const entries = await readdir(this.root).catch(() => [] as string[]);
    for (const name of entries) {
      if (ID.test(name) && !this.jobs.has(name)) await rm(join(this.root, name), { recursive: true, force: true });
    }
    return removed;
  }

  get size(): number {
    return this.jobs.size;
  }
}
