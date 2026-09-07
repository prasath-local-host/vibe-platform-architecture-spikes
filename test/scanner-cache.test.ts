import { mkdtemp, mkdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withScannerCache } from "../src/scanner-cache.js";

const roots: string[] = [];
async function root() { const path = await mkdtemp(join(tmpdir(), "vcp-cache-test-")); roots.push(path); return path; }
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
describe("shared scanner cache", () => {
  it("excludes another worker while a scan owns the cache", async () => {
    const path = await root();
    await withScannerCache(path, async () => {
      await expect(withScannerCache(path, async () => "must not enter", 0)).rejects.toThrow("busy");
      await expect(access(join(path, ".vcp-scan-lock"))).resolves.toBeUndefined();
    });
    await expect(withScannerCache(path, async () => "next owner")).resolves.toBe("next owner");
  });
  it("releases ownership after a failed scan", async () => {
    const path = await root();
    await expect(withScannerCache(path, async () => { throw new Error("scanner failed"); })).rejects.toThrow("scanner failed");
    await expect(withScannerCache(path, async () => "recovered", 0)).resolves.toBe("recovered");
  });
  it("never steals an abandoned lock automatically", async () => {
    const path = await root(); await mkdir(join(path, ".vcp-scan-lock"));
    await expect(withScannerCache(path, async () => "unsafe", 0)).rejects.toThrow("busy");
    await expect(access(join(path, ".vcp-scan-lock"))).resolves.toBeUndefined();
  });
});
