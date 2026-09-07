export interface Application {
  readonly id: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly createdAt: string;
}

export interface Assessment {
  readonly id: string;
  readonly applicationId: string;
  readonly repositoryUrl: string;
  readonly sourceRevision: string;
  readonly correlationId: string;
  readonly status: "queued" | "running" | "completed" | "failed";
  readonly createdAt: string;
}

let csrfToken = "";

export interface SecurityScan {
  readonly id: string;
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
export interface SecurityScanDetail extends SecurityScan { readonly report: Record<string, unknown> }

export interface BrowserIdentity { readonly subject: string; readonly displayName: string; readonly csrfToken: string }

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": crypto.randomUUID(),
      ...(!["GET", "HEAD"].includes(init?.method ?? "GET") ? { "x-csrf-token": csrfToken } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = `Request failed (${response.status})`;
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") message = parsed.message;
    } catch { /* Do not display arbitrary proxy HTML as an API error. */ }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const portalApi = {
  pipeline: (companyId: string, applicationId: string) => request<PipelineSnapshot>(`/companies/${encodeURIComponent(companyId)}/applications/${encodeURIComponent(applicationId)}/demo-pipeline`),
  pipelineSource: (companyId: string, applicationId: string) => request<{ sourceRevision: string }>(`/companies/${encodeURIComponent(companyId)}/applications/${encodeURIComponent(applicationId)}/demo-pipeline/source`),
  pipelineDispatch: (companyId: string, applicationId: string, command: { kind: "build" | "stage" | "prod"; sourceRevision?: string; buildId?: string; idempotencyKey: string }) => request<PipelineRun>(`/companies/${encodeURIComponent(companyId)}/applications/${encodeURIComponent(applicationId)}/demo-pipeline`, { method: "POST", body: JSON.stringify(command) }),
  securityScans: (companyId: string, applicationId: string) => request<SecurityScan[]>(`/companies/${encodeURIComponent(companyId)}/applications/${encodeURIComponent(applicationId)}/security-scans`),
  securityScan: (companyId: string, applicationId: string, scanId: string) => request<SecurityScanDetail>(`/companies/${encodeURIComponent(companyId)}/applications/${encodeURIComponent(applicationId)}/security-scans/${encodeURIComponent(scanId)}`),
  session: async () => {
    const response = await fetch("/auth/session", { credentials: "same-origin" });
    if (response.status === 401) return undefined;
    if (!response.ok) throw new Error("Unable to check the browser session");
    const value = await response.json() as BrowserIdentity;
    csrfToken = value.csrfToken;
    return value;
  },
  login: () => { window.location.assign("/auth/login"); },
  reauthenticate: () => { window.location.assign("/auth/login?reauthenticate=true"); },
  logout: () => request<{ logoutUrl: string }>("/auth/logout", { method: "POST" }),
  applications: (companyId: string) => request<Application[]>(`/companies/${encodeURIComponent(companyId)}/applications`),
  registerApplication: (companyId: string, name: string, repositoryUrl: string) =>
    request<Application>(`/companies/${encodeURIComponent(companyId)}/applications`, {
      method: "POST",
      body: JSON.stringify({ name, repositoryUrl, idempotencyKey: crypto.randomUUID() }),
    }),
  assessments: (companyId: string, applicationId: string) => request<Assessment[]>(`/companies/${encodeURIComponent(companyId)}/applications/${applicationId}/assessments`),
  submitAssessment: (companyId: string, applicationId: string, sourceRevision: string) =>
    request<Assessment>(`/companies/${encodeURIComponent(companyId)}/applications/${applicationId}/assessments`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), sourceRevision }),
    }),
};

export interface PipelineRun {
  id: string; kind: "build" | "stage" | "prod"; sourceRevision: string; buildId: string | null;
  runId: string | null; status: string; conclusion: string | null; createdAt: string; url: string | null;
}
export interface PipelineSnapshot { configured: boolean; runs: PipelineRun[] }
