import { mkdir, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Atomic directory creation also excludes scanners in other worker processes.
// A crashed owner's lock is deliberately not stolen: operators must verify it is idle.
export async function withScannerCache<T>(root: string, operation: (directory: string) => Promise<T>, waitMs = 300_000): Promise<T> {
  const directory = resolve(root);
  if (!root || directory.includes(",")) throw new Error("Scanner cache path is invalid");
  await mkdir(directory, { recursive: true });
  const lock = join(directory, ".vcp-scan-lock");
  const deadline = Date.now() + waitMs;
  while (true) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("Scanner cache is busy; approval denied");
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }
  try { return await operation(directory); }
  finally { await rmdir(lock); }
}
