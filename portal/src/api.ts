export interface Application {
  readonly id: string;
  readonly name: string;
  readonly repositoryUrl: string;
  readonly createdAt: string;
}

export interface Assessment {
  readonly id: string;
  readonly applicationId: string;
  readonly correlationId: string;
  readonly status: "queued" | "running" | "completed" | "failed";
  readonly createdAt: string;
}

let csrfToken = "";

export interface BrowserIdentity { readonly subject: string; readonly displayName: string; readonly csrfToken: string }

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
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const portalApi = {
  session: async () => {
    const response = await fetch("/auth/session", { credentials: "same-origin" });
    if (response.status === 401) return undefined;
    if (!response.ok) throw new Error("Unable to check the browser session");
    const value = await response.json() as BrowserIdentity;
    csrfToken = value.csrfToken;
    return value;
  },
  login: () => { window.location.assign("/auth/login"); },
  logout: () => request<{ logoutUrl: string }>("/auth/logout", { method: "POST" }),
  applications: (companyId: string) => request<Application[]>(`/companies/${encodeURIComponent(companyId)}/applications`),
  registerApplication: (companyId: string, name: string, repositoryUrl: string) =>
    request<Application>(`/companies/${encodeURIComponent(companyId)}/applications`, {
      method: "POST",
      body: JSON.stringify({ name, repositoryUrl, idempotencyKey: crypto.randomUUID() }),
    }),
  assessments: (companyId: string, applicationId: string) => request<Assessment[]>(`/companies/${encodeURIComponent(companyId)}/applications/${applicationId}/assessments`),
  submitAssessment: (companyId: string, applicationId: string) =>
    request<Assessment>(`/companies/${encodeURIComponent(companyId)}/applications/${applicationId}/assessments`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    }),
};
