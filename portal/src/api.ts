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

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-correlation-id": crypto.randomUUID(),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const portalApi = {
  applications: (companyId: string, token: string) =>
    request<Application[]>(`/companies/${encodeURIComponent(companyId)}/applications`, token),
  registerApplication: (companyId: string, token: string, name: string, repositoryUrl: string) =>
    request<Application>(`/companies/${encodeURIComponent(companyId)}/applications`, token, {
      method: "POST",
      body: JSON.stringify({ name, repositoryUrl, idempotencyKey: crypto.randomUUID() }),
    }),
  assessments: (companyId: string, applicationId: string, token: string) =>
    request<Assessment[]>(`/companies/${encodeURIComponent(companyId)}/applications/${applicationId}/assessments`, token),
  submitAssessment: (companyId: string, applicationId: string, token: string) =>
    request<Assessment>(`/companies/${encodeURIComponent(companyId)}/applications/${applicationId}/assessments`, token, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    }),
};
