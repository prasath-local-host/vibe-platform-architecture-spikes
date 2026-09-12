import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, portalApi, type ProjectSetup as Setup } from "./api";

export function ProjectSetup({ companyId, operator, onCreated }: { companyId: string; operator: boolean; onCreated: () => Promise<void> }) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = async () => { setSetup(await portalApi.projectSetup(companyId)); };
  useEffect(() => { let active = true; void portalApi.projectSetup(companyId).then(value => { if (active) setSetup(value); }).catch(() => { if (active) setError("Unable to load company repository setup."); }); return () => { active = false; }; }, [companyId]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(""); setStepUp(false);
    try { await action(); await load(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup failed. Contact the VCP team.");
      setStepUp(reason instanceof ApiError && reason.status === 401);
      try { await load(); } catch { /* Keep the original failure visible. */ }
    } finally { setBusy(false); }
  }
  function submitOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(() => portalApi.requestOrganization(companyId, String(data.get("organization")).trim()));
  }
  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(() => portalApi.approveOrganization(companyId, setup!.organization!.slug, String(data.get("reference")).trim()));
  }
  async function create(command: { name: string; repositoryName: string; idempotencyKey: string }) {
    await portalApi.createProject(companyId, command);
    if (active.current) { setRequestKey(crypto.randomUUID()); await onCreated(); }
  }
  function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(() => create({ name: String(data.get("name")).trim(), repositoryName: String(data.get("repositoryName")).trim(), idempotencyKey: requestKey }));
  }
  return <section className="card project-setup">
    <div className="section-title"><div><h2>Create a project through VCP</h2><p>Use your company’s GitHub organization for new applications.</p></div><button disabled={busy} onClick={() => void run(load)}>Refresh setup</button></div>
    {error && <div className="error" role="alert">{error}{stepUp && <button onClick={portalApi.reauthenticate}>Verify identity</button>}</div>}
    {!setup ? <p>Loading repository setup…</p> : !setup.configured ? <p>Repository creation is not enabled. Contact the VCP team to configure the GitHub connection.</p> : <>
      <p>Create your company organization on GitHub, install the GitHub App supplied by the VCP team, then enter the organization name below. The VCP team verifies company ownership before enabling repository creation.</p>
      {setup.organization ? <p><strong>{setup.organization.slug}</strong> · {setup.organization.status === "verified" ? "Verified organization" : "Awaiting VCP verification"}</p> : <form onSubmit={submitOrganization}><label>GitHub organization name<input name="organization" required maxLength={39} placeholder="your-company" /></label><button disabled={busy} type="submit">Submit organization</button></form>}
      {operator && setup.organization?.status === "pending" && <form onSubmit={approve}><p>Confirm the organization belongs to this company using your customer onboarding records. A GitHub App installation alone does not prove company ownership.</p><label>Ownership verification reference<input name="reference" required maxLength={200} placeholder="Onboarding ticket or approval reference" /></label><button disabled={busy} type="submit">Verify organization connection</button></form>}
      {setup.organization?.status === "verified" && <form onSubmit={submitProject}><label>Application name<input name="name" required maxLength={120} /></label><label>Repository name<input name="repositoryName" required pattern="[a-z0-9][a-z0-9-]{0,79}" maxLength={80} placeholder="customer-portal" /></label><p>Private repository · Next.js and PostgreSQL · VCP agent rules included. Database and deployment setup follow separately.</p><button disabled={busy} className="primary" type="submit">{busy ? "Working…" : "Create private repository"}</button></form>}
      {setup.projects.map(project => <div className="assessment" key={project.id}><strong>{project.name}</strong><span>{project.status === "ready" ? "Initialized" : project.status === "creating" ? "Creation unconfirmed — contact VCP before retrying" : "Initialization pending"}</span>{project.status === "initializing" && <button disabled={busy} onClick={() => void run(() => create({ name: project.name, repositoryName: project.repositoryName, idempotencyKey: project.idempotencyKey }))}>Resume initialization</button>}{project.status === "ready" && project.repositoryUrl && <a href={project.repositoryUrl} target="_blank" rel="noreferrer">Open repository</a>}</div>)}
    </>}
  </section>;
}
