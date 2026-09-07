import { requireCompanyAccess, type Actor } from "./domain.js";
import type { BuildRecordRepository } from "./build-job-service.js";
import type { ReleaseRepository } from "./release-service.js";

export interface ScanSummary {
  readonly id: string;
  readonly companyId: string;
  readonly entityId: string;
  readonly identity: string;
  readonly kind: "fs" | "image";
  readonly status: "approved" | "rejected";
  readonly scannedAt: string;
  readonly scannerImage: string;
  readonly policy: string;
  readonly componentCount: number;
  readonly findings: readonly { readonly id: string; readonly severities: readonly string[] }[];
}
export interface ScanDetail extends ScanSummary { readonly report: Record<string, unknown> }
export interface ScanEvidenceReader {
  list(companyId: string, entities: ReadonlySet<string>): Promise<readonly ScanSummary[]>;
  get(companyId: string, entities: ReadonlySet<string>, id: string): Promise<ScanDetail | undefined>;
}

export class ScanEvidenceService {
  constructor(private readonly reader: ScanEvidenceReader, private readonly builds: BuildRecordRepository, private readonly releases: ReleaseRepository) {}
  private async entities(actor: Actor, companyId: string, applicationId: string) {
    requireCompanyAccess(actor, companyId);
    const [builds, releases] = await Promise.all([this.builds.listByApplication(companyId, applicationId), this.releases.listByApplication(companyId, applicationId)]);
    return new Set([...builds.map((build) => `fs:${build.id}`), ...releases.map((release) => `image:${release.id}`)]);
  }
  async list(actor: Actor, companyId: string, applicationId: string) {
    return this.reader.list(companyId, await this.entities(actor, companyId, applicationId));
  }
  async get(actor: Actor, companyId: string, applicationId: string, id: string) {
    return this.reader.get(companyId, await this.entities(actor, companyId, applicationId), id);
  }
}
