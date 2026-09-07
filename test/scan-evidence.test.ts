import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemScanEvidenceReader } from "../src/filesystem-scan-evidence.js";
import { ScanEvidenceService } from "../src/scan-evidence-service.js";
import { ScanEvidenceController } from "../src/scan-evidence-controller.js";
import type { BuildRecordRepository } from "../src/build-job-service.js";
import type { ReleaseRepository } from "../src/release-service.js";
import type { IdentityService } from "../src/identity.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function setup() {
  root = await mkdtemp(join(tmpdir(), "vcp-evidence-test-"));
  const report = { bomFormat: "CycloneDX", specVersion: "1.6", components: [{ name: "lodash", version: "4.17.15" }], vulnerabilities: [{ id: "CVE-fixture", description: "Preserve full SBOM data", ratings: [{ severity: "high", method: "CVSSv3" }] }] };
  const evidence = { id: randomUUID(), companyId: "company-a", entityId: "build-a", identity: "sha256:source", kind: "fs", status: "rejected", scannedAt: new Date().toISOString(), scannerImage: "scanner@sha256:digest", policy: "policy/1", report };
  for (const value of [evidence, { ...evidence, id: randomUUID(), companyId: "company-b" }, { ...evidence, id: randomUUID(), entityId: "other-application-build" }]) await writeFile(join(root, `${value.id}.json`), JSON.stringify(value));
  return { evidence, reader: new FilesystemScanEvidenceReader(root) };
}
describe("scan evidence authorization and report preservation", () => {
  it("lists only the requested company and application entities, including rejected scans", async () => {
    const { reader, evidence } = await setup();
    const list = await reader.list("company-a", new Set(["fs:build-a"]));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: evidence.id, status: "rejected", componentCount: 1, findings: [{ id: "CVE-fixture", severities: ["high"] }] });
    expect(list[0]).not.toHaveProperty("report");
  });
  it("preserves the full CycloneDX document and denies guessed foreign identifiers", async () => {
    const { reader, evidence } = await setup();
    expect((await reader.get("company-a", new Set(["fs:build-a"]), evidence.id))?.report).toEqual(evidence.report);
    expect(await reader.get("company-b", new Set(["fs:build-a"]), evidence.id)).toBeUndefined();
    expect(await reader.get("company-a", new Set(["fs:other"]), evidence.id)).toBeUndefined();
    expect(await reader.get("company-a", new Set(["image:build-a"]), evidence.id)).toBeUndefined();
    expect(await reader.get("company-a", new Set(["fs:build-a"]), "../secret")).toBeUndefined();
  });
  it("checks authorization before reading storage or looking up entity ownership", async () => {
    const service = new ScanEvidenceService({ async list() { throw new Error("must not read"); }, async get() { throw new Error("must not read"); } }, {} as BuildRecordRepository, {} as ReleaseRepository);
    await expect(service.list({ subject: "user", role: "company-user", companyId: "company-a" }, "company-b", "app")).rejects.toThrow("forbidden");
  });
  it("maps only application-scoped entity IDs and returns 404 across applications", async () => {
    const { reader, evidence } = await setup();
    const builds = { async listByApplication(companyId: string, applicationId: string) { return companyId === "company-a" && applicationId === "app-a" ? [{ id: "build-a" }] : []; } } as unknown as BuildRecordRepository;
    const releases = { async listByApplication() { return []; } } as unknown as ReleaseRepository;
    const service = new ScanEvidenceService(reader, builds, releases);
    const actor = { subject: "operator", role: "operator" as const };
    expect(await service.list(actor, "company-a", "app-a")).toHaveLength(1);
    const controller = new ScanEvidenceController(service, { async resolveActor() { return actor; } } as unknown as IdentityService);
    await expect(controller.get("company-a", "app-b", evidence.id, {})).rejects.toMatchObject({ status: 404 });
  });
});
