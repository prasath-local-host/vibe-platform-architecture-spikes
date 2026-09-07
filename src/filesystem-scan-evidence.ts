import { open, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ScanDetail, ScanEvidenceReader, ScanSummary } from "./scan-evidence-service.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  id: z.string().uuid(), companyId: z.string(), entityId: z.string(), identity: z.string(),
  kind: z.enum(["fs", "image"]), status: z.enum(["approved", "rejected"]),
  scannedAt: z.string().datetime(), scannerImage: z.string(), policy: z.string(),
  report: z.object({
    bomFormat: z.literal("CycloneDX"),
    components: z.array(z.unknown()).optional(),
    vulnerabilities: z.array(z.object({ id: z.string(), ratings: z.array(z.object({ severity: z.string() }).passthrough()) }).passthrough()).optional(),
  }).passthrough(),
});

export class FilesystemScanEvidenceReader implements ScanEvidenceReader {
  private readonly root: string | undefined;
  constructor(root?: string) { this.root = root ? resolve(root) : undefined; }
  async get(companyId: string, entities: ReadonlySet<string>, id: string): Promise<ScanDetail | undefined> {
    if (!this.root || !uuid.test(id)) return undefined;
    try {
      const file = await open(join(this.root, `${id}.json`), "r");
      let data: unknown;
      try {
        if ((await file.stat()).size > 17 * 1024 * 1024) throw new Error("Scan evidence exceeds the read limit");
        data = JSON.parse(await file.readFile("utf8"));
      } finally { await file.close(); }
      const evidence = schema.parse(data);
      if (evidence.id !== id || evidence.companyId !== companyId || !entities.has(`${evidence.kind}:${evidence.entityId}`)) return undefined;
      return { ...evidence, componentCount: evidence.report.components?.length ?? 0,
        findings: (evidence.report.vulnerabilities ?? []).map((item) => ({ id: item.id, severities: [...new Set(item.ratings.map((rating) => rating.severity.toLowerCase()))] })),
      };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async list(companyId: string, entities: ReadonlySet<string>): Promise<readonly ScanSummary[]> {
    if (!this.root || !entities.size) return [];
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      if (entries.length > 10_000) throw new Error("Scan evidence index requires archival before listing");
      const result: ScanSummary[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const evidence = await this.get(companyId, entities, entry.name.slice(0, -5));
        if (evidence) { const { report: _report, ...summary } = evidence; result.push(summary); }
      }
      return result.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
}
