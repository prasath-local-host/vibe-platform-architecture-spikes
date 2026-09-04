import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { portalApi, type Application, type Assessment } from "./api";
import { MemorySession, type PortalRole, type PortalSession } from "./auth-session";
import "./styles.css";

const authSession = new MemorySession();

function Login({ onSignedIn }: { onSignedIn: (session: PortalSession) => void }) {
  const [identity, setIdentity] = useState<{ subject: string; displayName: string }>();
  const [companyId, setCompanyId] = useState("demo-company");
  const [role, setRole] = useState<PortalRole>("operator");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void portalApi.session()
      .then(setIdentity)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Sign-in failed"))
      .finally(() => setLoading(false));
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!identity) return;
    const session: PortalSession = {
      subject: identity.subject,
      displayName: identity.displayName,
      role,
      ...(role === "company-user" ? { companyId } : {}),
    };
    authSession.signIn(session);
    onSignedIn(session);
  }

  return <main className="login-shell">
    <section className="login-story">
      <span className="eyebrow">LOCALHOST · VIBE CODING PLATFORM</span>
      <h1>Ship AI-built applications with confidence.</h1>
      <p>One secure control plane for deployment readiness, assessments, and operational ownership.</p>
      <div className="trust-row"><span>Company isolation</span><span>Auditable workflows</span><span>Automated checks</span></div>
    </section>
    <section className="login-panel">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand-mark">V</div>
        <div><span className="eyebrow blue">CONTROL PORTAL</span><h2>{identity ? `Welcome, ${identity.displayName}` : "Welcome back"}</h2><p>Authenticate with the federated identity provider, then open an authorized workspace.</p></div>
        {error && <div className="error">{error}</div>}
        {!identity ? <button className="primary" type="button" disabled={loading} onClick={portalApi.login}>{loading ? "Checking session…" : "Sign in with Keycloak"}</button> : <>
          <label>Workspace type<select value={role} onChange={(event) => setRole(event.target.value as PortalRole)}><option value="operator">LocalHost operator</option><option value="company-user">Company user</option></select></label>
          {role === "company-user" && <label>Company ID<input value={companyId} onChange={(event) => setCompanyId(event.target.value)} required /></label>}
          <button className="primary" type="submit">Continue to portal</button>
        </>}
        <small>Authorization Code + PKCE. Provider tokens remain on the server; the browser receives only an HTTP-only session cookie.</small>
      </form>
    </section>
  </main>;
}

function Portal({ session, onSignOut }: { session: PortalSession; onSignOut: () => void }) {
  const [companyInput, setCompanyInput] = useState(session.companyId ?? "demo-company");
  const [companyId, setCompanyId] = useState(session.companyId ?? "demo-company");
  const [applications, setApplications] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application>();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [sourceRevision, setSourceRevision] = useState("");

  async function loadApplications(target = companyId) {
    setLoading(true); setError("");
    try { setApplications(await portalApi.applications(target)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load applications"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadApplications(); }, [companyId]);
  useEffect(() => {
    if (!selected) { setAssessments([]); return; }
    void portalApi.assessments(companyId, selected.id).then(setAssessments).catch(() => setAssessments([]));
  }, [selected, companyId]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await portalApi.registerApplication(companyId, String(data.get("name")), String(data.get("repositoryUrl")));
      setShowRegister(false); await loadApplications();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Registration failed"); }
  }

  async function assess(application: Application) {
    setSelected(application); setError("");
    try {
      await portalApi.submitAssessment(companyId, application.id, sourceRevision.trim());
      setTimeout(() => void portalApi.assessments(companyId, application.id).then(setAssessments), 650);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Assessment failed"); }
  }

  return <div className="app-shell">
    <aside>
      <div className="logo"><span>V</span><strong>Vibe Platform</strong></div>
      <nav><button className="active">Overview</button><button>Applications</button><button>Assessments</button><button>Activity</button></nav>
      <div className="aside-footer"><span>{session.role === "operator" ? "LocalHost operator" : "Company user"}</span><strong>{session.subject}</strong><button onClick={onSignOut}>Sign out</button></div>
    </aside>
    <main className="workspace">
      <header><div><span className="eyebrow blue">CONTROL PLANE</span><h1>{session.role === "operator" ? "Customer applications" : "Your applications"}</h1><p>{session.role === "operator" ? "Review applications and readiness by customer." : `Manage AI-built applications for ${companyId}.`}</p></div><button className="primary" onClick={() => setShowRegister(true)}>Register application</button></header>
      {session.role === "operator" && <section className="company-switcher card"><label>Customer<input value={companyInput} onChange={(event) => setCompanyInput(event.target.value)} /></label><button onClick={() => { setSelected(undefined); setCompanyId(companyInput.trim()); }}>Open customer</button><span>Currently viewing <strong>{companyId}</strong></span></section>}
      <section className="metrics"><article><span>Applications</span><strong>{applications.length}</strong><small>Registered for this customer</small></article><article><span>Selected assessments</span><strong>{assessments.length}</strong><small>Queue and completion history</small></article><article><span>Platform status</span><strong className="healthy">Healthy</strong><small>PostgreSQL and worker online</small></article></section>
      {error && <div className="error">{error}</div>}
      <section className="content-grid">
        <div className="card table-card"><div className="section-title"><div><h2>Applications</h2><p>Repositories managed through the control plane.</p></div><button onClick={() => void loadApplications()}>Refresh</button></div>
          {loading ? <p className="empty">Loading applications…</p> : applications.length === 0 ? <p className="empty">No applications registered for this customer.</p> : <div className="app-list">{applications.map((application) => <button key={application.id} className={selected?.id === application.id ? "app-row selected" : "app-row"} onClick={() => setSelected(application)}><span className="app-icon">{application.name.slice(0, 1)}</span><span><strong>{application.name}</strong><small>{application.repositoryUrl}</small></span><span className="badge">Connected</span></button>)}</div>}
        </div>
        <div className="card detail-card">{selected ? <><div className="section-title"><div><span className="eyebrow blue">APPLICATION</span><h2>{selected.name}</h2></div><span className="badge">{companyId}</span></div><dl><div><dt>Repository</dt><dd>{selected.repositoryUrl}</dd></div><div><dt>Registered</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div></dl><label>Commit SHA<input value={sourceRevision} onChange={(event) => setSourceRevision(event.target.value)} pattern="[0-9a-fA-F]{40}" maxLength={40} required placeholder="40-character Git commit SHA" /></label><button className="primary full" disabled={!/^[0-9a-f]{40}$/i.test(sourceRevision.trim())} onClick={() => void assess(selected)}>Run assessment</button><h3>Assessment history</h3>{assessments.length ? assessments.map((assessment) => <div className="assessment" key={assessment.id}><span className={`status ${assessment.status}`}>{assessment.status}</span><small>{assessment.sourceRevision.slice(0, 12)} · {assessment.correlationId}</small></div>) : <p className="empty">No assessments yet.</p>}</> : <div className="empty-state"><div>↗</div><h2>Select an application</h2><p>Open an application to view its deployment assessment history.</p></div>}</div>
      </section>
      {showRegister && <div className="modal-backdrop"><form className="card modal" onSubmit={register}><div className="section-title"><div><span className="eyebrow blue">NEW APPLICATION</span><h2>Connect a repository</h2></div><button type="button" onClick={() => setShowRegister(false)}>×</button></div><label>Application name<input name="name" required placeholder="Customer evaluation portal" /></label><label>Repository URL<input name="repositoryUrl" type="url" required placeholder="https://github.com/company/application" /></label><div className="modal-actions"><button type="button" onClick={() => setShowRegister(false)}>Cancel</button><button className="primary" type="submit">Register application</button></div></form></div>}
    </main>
  </div>;
}

function App() {
  const [session, setSession] = useState<PortalSession>();
  return session ? <Portal session={session} onSignOut={() => { void portalApi.logout().then(({ logoutUrl }) => window.location.assign(logoutUrl)).finally(() => { authSession.signOut(); setSession(undefined); }); }} /> : <Login onSignedIn={setSession} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
