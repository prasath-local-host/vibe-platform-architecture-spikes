import { useEffect, useState } from "react";
import { portalApi, type SecurityScan, type SecurityScanDetail } from "./api";

function ScanDetail({ companyId, applicationId, scanId }: { companyId: string; applicationId: string; scanId: string }) {
  const [detail, setDetail] = useState<SecurityScanDetail>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void portalApi.securityScan(companyId, applicationId, scanId).then((value) => { if (active) setDetail(value); }).catch(() => { if (active) setError("Unable to load this scan. Refresh the scan list and try again."); });
    return () => { active = false; };
  }, [companyId, applicationId, scanId]);
  function download() {
    if (!detail) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(detail.report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `scan-${detail.id}.cyclonedx.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (error) return <p role="alert" className="error">{error}</p>;
  if (!detail) return <p role="status">Loading scan details…</p>;
  return <div className="scan-detail">
    <div className="section-title"><h3>{detail.kind === "fs" ? "Dependency scan" : "Runtime image scan"}</h3><button onClick={download}>Download SBOM</button></div>
    <p>{detail.status === "approved" ? "Passed the configured vulnerability policy." : "Blocked by the configured vulnerability policy."} This is a saved result from {new Date(detail.scannedAt).toLocaleString()}.</p>
    <dl><div><dt>Components</dt><dd>{detail.componentCount}</dd></div><div><dt>Policy</dt><dd>{detail.policy}</dd></div><div><dt>Build / release</dt><dd>{detail.entityId}</dd></div><div><dt>Scanned target</dt><dd>{detail.identity}</dd></div></dl>
    <h4>Vulnerability findings ({detail.findings.length})</h4>
    {detail.findings.length ? <ul className="scan-findings">{detail.findings.map((finding, index) => <li key={`${finding.id}-${index}`}><strong>{finding.id}</strong><span>{finding.severities.join(", ")}</span></li>)}</ul> : <p>No vulnerabilities reported by this scan.</p>}
  </div>;
}

export function SecurityScans({ companyId, applicationId }: { companyId: string; applicationId: string }) {
  const [scans, setScans] = useState<SecurityScan[]>([]);
  const [selected, setSelected] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setScans([]); setSelected(undefined); setError("");
    void portalApi.securityScans(companyId, applicationId).then((value) => { if (active) setScans(value); }).catch(() => { if (active) setError("Unable to load security scans. Check your access and try Refresh."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, applicationId, refresh]);
  return <section className="card security-scans" aria-label="Security scans">
    <div className="section-title"><div><h2>Security scans</h2><p>Dependency and runtime checks for this application's builds and releases.</p></div><button disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh scans</button></div>
    {error ? <p role="alert" className="error">{error}</p> : loading ? <p role="status">Loading security scans…</p> : !scans.length ? <p className="empty">No saved scans for this application. Scans appear when a configured build or deployment runs.</p> : <div className="scan-layout"><div className="scan-list">{scans.map((scan) => <button key={scan.id} className={`scan-row ${selected === scan.id ? "selected" : ""}`} aria-pressed={selected === scan.id} onClick={() => setSelected(scan.id)}><strong>{scan.kind === "fs" ? "Dependencies" : "Runtime image"}</strong><span className={`status ${scan.status === "approved" ? "completed" : "failed"}`}>{scan.status === "approved" ? "Passed policy" : "Blocked"}</span><small>{new Date(scan.scannedAt).toLocaleString()} · {scan.findings.length} findings</small></button>)}</div>{selected ? <ScanDetail key={selected} companyId={companyId} applicationId={applicationId} scanId={selected} /> : <p className="empty">Select a scan to review findings and download its SBOM.</p>}</div>}
  </section>;
}
