import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createProcessor } from "./processor";
import { runSteps } from "./runner";
import { JobStore } from "./store";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const root = process.env.WORK_DIR ?? "/dev/shm/jobs";
await mkdir(root, { recursive: true, mode: 0o700 });

const store = new JobStore({ root });
// Anything left from a previous run is deleted before we accept uploads.
await store.sweep();
setInterval(() => void store.sweep(), 60_000).unref();

const app = createApp({
  store,
  process: createProcessor(runSteps),
  downloadSecret: required("DOWNLOAD_TOKEN_SECRET"),
  serverToken: required("CONVERT_SERVER_TOKEN"),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  log: (line) => console.log(line),
  concurrency: Number(process.env.CONCURRENCY ?? 2),
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port });
console.log(JSON.stringify({ event: "listening", port }));
