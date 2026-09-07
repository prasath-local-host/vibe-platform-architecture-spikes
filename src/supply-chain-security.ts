import type { SourceArtifact } from "./build-service.js";

export interface SupplyChainEvidence {
  readonly id: string;
  readonly digest: string;
}

export interface SupplyChainScanner {
  scanSource(companyId: string, buildId: string, source: SourceArtifact): Promise<SupplyChainEvidence>;
  scanImage(companyId: string, releaseId: string, image: string): Promise<SupplyChainEvidence>;
}
