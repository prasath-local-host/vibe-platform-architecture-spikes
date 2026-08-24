import { describe, expect, it } from "vitest";
import { ApplicationService } from "../src/application-service.js";
import { ForbiddenError, type Actor } from "../src/domain.js";
import { InMemoryApplicationRepository, InMemoryAuditRepository } from "../src/in-memory-repositories.js";

const companyA: Actor = { subject: "user-a", role: "company-user", companyId: "company-a" };
const companyB: Actor = { subject: "user-b", role: "company-user", companyId: "company-b" };

function fixture() {
  const audit = new InMemoryAuditRepository();
  const transactionalApplications = new InMemoryApplicationRepository(audit);
  return { applications: transactionalApplications, audit, service: new ApplicationService(transactionalApplications, audit) };
}

describe("company isolation", () => {
  it("denies a company user access to another company", async () => {
    const { service } = fixture();
    await expect(service.list(companyA, "company-b")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns only the actor's company applications", async () => {
    const { service } = fixture();
    await service.register({ actor: companyA, companyId: "company-a", name: "A", repositoryUrl: "https://example.test/a", idempotencyKey: "request-a", correlationId: "corr-a" });
    await service.register({ actor: companyB, companyId: "company-b", name: "B", repositoryUrl: "https://example.test/b", idempotencyKey: "request-b", correlationId: "corr-b" });
    expect((await service.list(companyA, "company-a")).map((row) => row.name)).toEqual(["A"]);
  });
});

describe("idempotency and audit", () => {
  it("does not duplicate an application or audit event", async () => {
    const { service, audit } = fixture();
    const command = { actor: companyA, companyId: "company-a", name: "A", repositoryUrl: "https://example.test/a", idempotencyKey: "request-a", correlationId: "corr-a" } as const;
    const first = await service.register(command);
    const second = await service.register(command);
    expect(second.id).toBe(first.id);
    expect(await audit.listByCompany("company-a")).toHaveLength(1);
  });

  it("records attributable, correlated audit evidence", async () => {
    const { service, audit } = fixture();
    await service.register({ actor: companyA, companyId: "company-a", name: "A", repositoryUrl: "https://example.test/a", idempotencyKey: "request-a", correlationId: "corr-a" });
    expect(await audit.listByCompany("company-a")).toMatchObject([{ actorSubject: "user-a", action: "application.registered", correlationId: "corr-a" }]);
  });
});
