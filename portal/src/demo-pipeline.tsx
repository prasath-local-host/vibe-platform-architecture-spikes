import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, portalApi, type PipelineSnapshot } from "./api";

export function DemoPipeline({ companyId, applicationId }: { companyId: string; applicationId: string }) {
  const [snapshot, setSnapshot] = useState<PipelineSnapshot>();
  const [source, setSource] = useState("");
  const [buildId, setBuildId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [confirmProd, setConfirmProd] = useState(false);
  const keys = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const showError = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "Unable to contact the pipeline.");
    setAuthRequired(reason instanceof ApiError && reason.status === 401);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const result = await portalApi.pipeline(companyId, applicationId);
      if (mounted.current) { setSnapshot(result); setFresh(true); }
    } catch (reason) { if (mounted.current) { setFresh(false); showError(reason); } }
  }, [companyId, applicationId, showError]);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(() => void poll(), 10_000); };
    void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); };
  }, [refresh]);
  const runs = snapshot?.runs ?? [];
  const builds = runs.filter(run => run.kind === "build");
  const selected = builds.find(run => run.id === buildId) ?? builds[0];
  const stage = runs.find(run => run.kind === "stage");
  const active = runs.some(run => run.status !== "completed");
  const enabled = fresh && snapshot?.configured && !busy && !active;
  const built = selected?.status === "completed" && selected.conclusion === "success";
  const staged = built && stage?.buildId === selected?.id && stage?.status === "completed" && stage.conclusion === "success";
  async function dispatch(kind: "build" | "stage" | "prod") {
    setBusy(true); setError(""); setAuthRequired(false); setConfirmProd(false);
    const fingerprint = `${kind}:${kind === "build" ? source.trim() : selected?.id}`;
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    try {
      await portalApi.pipelineDispatch(companyId, applicationId, { kind, idempotencyKey: key,
        ...(kind === "build" ? { sourceRevision: source.trim() } : { buildId: selected!.id }) });
      keys.current.delete(fingerprint);
      await refresh();
    } catch (reason) { showError(reason); await refresh(); }
    finally { setBusy(false); }
  }
  return <section className="card pipeline-card" aria-label="Build and deployments">
    <div className="section-title"><div><span className="eyebrow blue">DELIVERY PIPELINE</span><h2>Build → Stage → Prod</h2><p>Build once. Promote the same tested and security-checked artifact.</p></div><button disabled={busy} onClick={() => void refresh()}>Refresh pipeline</button></div>
    {!snapshot ? <p>Loading pipeline…</p> : !snapshot.configured ? <p>Pipeline not configured for this application. Ask an operator to connect its GitHub workflow on the server.</p> : <>
      <p className="pipeline-note">Builds run on GitHub-hosted infrastructure. Deployments run on the Ubuntu runner. Status refreshes every 10 seconds; deployment success includes health verification at deployment time.</p>
      <label>Source commit (main)<input value={source} onChange={event => setSource(event.target.value.toLowerCase())} maxLength={40} placeholder="Use latest main or paste a 40-character SHA" /></label>
      <div className="pipeline-actions"><button disabled={busy || !fresh} onClick={() => {
        setBusy(true); setError("");
        void portalApi.pipelineSource(companyId, applicationId).then(result => setSource(result.sourceRevision)).catch(showError).finally(() => setBusy(false));
      }}>Use latest main</button><button className="primary" disabled={!enabled || !/^[0-9a-f]{40}$/.test(source.trim())} onClick={() => void dispatch("build")}>Build, test & scan</button></div>
      <label>Build to promote<select value={selected?.id ?? ""} onChange={event => { setBuildId(event.target.value); setConfirmProd(false); }}>
        {!builds.length && <option value="">No portal builds yet</option>}
        {builds.map(run => <option key={run.id} value={run.id}>{run.sourceRevision.slice(0, 12)} · {run.conclusion ?? run.status} · {new Date(run.createdAt).toLocaleString()}</option>)}
      </select></label>
      <div className="pipeline-actions"><button disabled={!enabled || !built} onClick={() => void dispatch("stage")}>Deploy to Stage</button><button className="primary" disabled={!enabled || !staged} onClick={() => setConfirmProd(true)}>Promote to Prod</button></div>
      {confirmProd && <div className="pipeline-confirm" role="alert"><p>Deploy commit <strong>{selected?.sourceRevision.slice(0, 12)}</strong> to Prod? This replaces the running demo application. Stage must still pass the server-side promotion checks.</p><button onClick={() => setConfirmProd(false)}>Cancel</button> <button className="primary" disabled={!enabled || !staged} onClick={() => void dispatch("prod")}>Confirm Prod deployment</button></div>}
      {active && <p role="status">A pipeline request is active. Wait for it to complete before starting another. If it stays “dispatching”, refresh or ask an operator to reconcile it—do not start duplicate runs in GitHub.</p>}
      <h3>Run history</h3>
      {!runs.length ? <p>No runs started from this portal yet. Existing GitHub runs are not imported automatically.</p> : <div className="pipeline-history">{runs.map(run => <article key={run.id}><strong>{run.kind === "build" ? "Build / tests / security" : `${run.kind === "stage" ? "Stage" : "Prod"} deployment`}</strong><span className={`status ${run.conclusion === "success" ? "completed" : run.conclusion ? "failed" : "running"}`}>{run.conclusion ?? run.status}</span><code>{run.sourceRevision.slice(0, 12)}</code><small>{new Date(run.createdAt).toLocaleString()}</small>{run.url && <a href={run.url} target="_blank" rel="noreferrer">View checks and logs ↗</a>}</article>)}</div>}
    </>}
    {error && <div className="error" role="alert">{error}{authRequired && <><p>Sign in again with your authenticator, reopen the application and check run history before retrying.</p><button onClick={portalApi.reauthenticate}>Verify identity</button></>}</div>}
  </section>;
}
