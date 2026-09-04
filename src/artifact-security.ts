import { verifyBuildArtifact, type BuildArtifact } from "./artifact-service.js";

export interface ArtifactSecurityDecision {
  readonly status: "approved" | "rejected";
  readonly scanner: string;
  readonly scannedAt: string;
  readonly findings: readonly string[];
}

export interface ArtifactSecurityScanner {
  scan(artifact: BuildArtifact): Promise<ArtifactSecurityDecision>;
}

const eicarSignature = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const privateKeyMarkers = ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----"];

export class BaselineArtifactSecurityScanner implements ArtifactSecurityScanner {
  async scan(artifact: BuildArtifact): Promise<ArtifactSecurityDecision> {
    verifyBuildArtifact(artifact);
    const findings: string[] = [];
    for (const file of artifact.files) {
      const content = Buffer.from(file.content).toString("utf8");
      if (content.includes(eicarSignature)) findings.push(`${file.path}: antivirus test signature detected`);
      if (privateKeyMarkers.some((marker) => content.includes(marker))) findings.push(`${file.path}: embedded private key detected`);
    }
    return {
      status: findings.length ? "rejected" : "approved",
      scanner: "vcp-baseline-artifact-security/1",
      scannedAt: new Date().toISOString(),
      findings,
    };
  }
}
