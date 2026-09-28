import { execFile } from "node:child_process";
import type { Step } from "./commands";

const DEFAULT_TIMEOUT_MS = 2 * 60_000;

/** Runs steps in order, without a shell. Output is discarded: it can contain document text. */
export async function runSteps(steps: Step[], workDir: string): Promise<void> {
  for (const step of steps) {
    await new Promise<void>((resolve, reject) => {
      execFile(
        step.cmd,
        step.args,
        {
          cwd: workDir,
          timeout: step.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          killSignal: "SIGKILL",
          maxBuffer: 16 * 1024 * 1024,
          // HOME inside the job folder keeps LibreOffice, fontconfig, etc. from writing anywhere else.
          env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: workDir, LANG: "C.UTF-8", TMPDIR: workDir },
        },
        (err) => (err ? reject(new Error(`${step.cmd} failed`)) : resolve()),
      );
    });
  }
}
