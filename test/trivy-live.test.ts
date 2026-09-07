import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createSourceArtifact } from "../src/build-service.js";
import { TrivySupplyChainScanner } from "../src/trivy-supply-chain-scanner.js";

const image = process.env.VCP_E2E_TRIVY_IMAGE;
const network = process.env.VCP_E2E_TRIVY_NETWORK;
const runtimeImage = process.env.VCP_E2E_RUNTIME_IMAGE;
describe.skipIf(!image || !network)("live Trivy integration", () => {
  let cacheRoot: string;
  beforeAll(async () => { cacheRoot = await mkdtemp(join(tmpdir(), "vcp-trivy-live-cache-")); });
  afterAll(async () => { if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true }); });
  it.skipIf(!runtimeImage)("scans a digest-pinned runtime image through the registry and retains its decision", async () => {
    const root = await mkdtemp(join(tmpdir(), "vcp-trivy-image-live-"));
    try {
      const scanner = new TrivySupplyChainScanner({ image: image!, network: network!, evidenceRoot: root, cacheRoot });
      try { await scanner.scanImage("platform-fixture", "live-image-scan", runtimeImage!); }
      catch (error) { if (!(error instanceof Error) || !error.message.includes("policy rejected")) throw error; }
      const files = await readdir(root);
      expect(files).toHaveLength(1);
      const evidence = JSON.parse(await readFile(join(root, files[0]!), "utf8"));
      expect(evidence.identity).toBe(runtimeImage);
      expect(evidence.report.bomFormat).toBe("CycloneDX");
      expect(evidence.report.components.length).toBeGreaterThan(0);
      expect(["approved", "rejected"]).toContain(evidence.status);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 360_000);
  it("generates a CycloneDX dependency report and enforces the vulnerability policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "vcp-trivy-live-"));
    try {
      const scanner = new TrivySupplyChainScanner({ image: image!, network: network!, evidenceRoot: root, cacheRoot });
      const source = createSourceArtifact("a".repeat(40), [
        { path: "package.json", content: JSON.stringify({ name: "vcp-vulnerable-fixture", version: "1.0.0", dependencies: { lodash: "4.17.15" } }) },
        { path: "package-lock.json", content: JSON.stringify({ name: "vcp-vulnerable-fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "vcp-vulnerable-fixture", version: "1.0.0", dependencies: { lodash: "4.17.15" } }, "node_modules/lodash": { version: "4.17.15", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz" } } }) },
      ]);
      let rejected = false;
      try { await scanner.scanSource("platform-fixture", "live-dependency-scan", source); }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes("policy rejected")) throw error;
        rejected = true;
      }
      expect(rejected).toBe(true);
      const files = await readdir(root);
      expect(files).toHaveLength(1);
      const evidence = JSON.parse(await readFile(join(root, files[0]!), "utf8"));
      expect(evidence.status).toBe("rejected");
      expect(evidence.report.bomFormat).toBe("CycloneDX");
      expect(evidence.report.components.some((component: { name: string }) => component.name === "lodash")).toBe(true);
      expect(evidence.report.vulnerabilities.length).toBeGreaterThan(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 360_000);
});
