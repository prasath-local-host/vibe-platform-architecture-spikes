import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApplicationService } from "../src/application-service.js";
import { AppController } from "../src/controller.js";
import {
  IdentityService,
  InMemoryAuthorizationRepository,
  SpikeAccessTokenVerifier,
  type AccessTokenVerifier,
} from "../src/identity.js";
import {
  InMemoryApplicationRepository,
  InMemoryAuditRepository,
} from "../src/in-memory-repositories.js";

function fixture() {
  const audit = new InMemoryAuditRepository();
  const applications = new InMemoryApplicationRepository(audit);
  const identity = new IdentityService(
    new SpikeAccessTokenVerifier(true),
    new InMemoryAuthorizationRepository([
      { subject: "user-a", companyId: "company-a" },
      { subject: "user-b", companyId: "company-b" },
      { subject: "disabled-user", companyId: "company-a", active: false },
      { subject: "operator-a", platformOperator: true },
    ]),
    [],
    ["otp"],
  );
  return {
    audit,
    controller: new AppController(
      new ApplicationService(applications, audit),
      identity,
    ),
  };
}

async function expectStatus(operation: Promise<unknown>, status: number) {
  try {
    await operation;
    throw new Error("Expected request to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
  }
}

describe("controller authorization", () => {
  it("requires a verified identity even when legacy identity headers are forged", async () => {
    const { controller } = fixture();
    await expectStatus(
      controller.list("company-a", {
        "x-spike-subject": "operator-a",
        "x-spike-role": "operator",
        "x-spike-company-id": "company-a",
      }),
      401,
    );
  });

  it("does not accept a forged company header for another tenant", async () => {
    const { controller } = fixture();
    await expectStatus(
      controller.list("company-b", {
        authorization: "Bearer spike:user-a",
        "x-spike-company-id": "company-b",
      }),
      403,
    );
  });

  it("prevents a company user from registering in another company", async () => {
    const { controller } = fixture();
    await expectStatus(
      controller.register(
        "company-b",
        { authorization: "Bearer spike:user-a" },
        {
          name: "Forbidden",
          repositoryUrl: "https://example.test/forbidden",
          idempotencyKey: "forbidden-request",
        },
      ),
      403,
    );
  });

  it("keeps application listings isolated by company", async () => {
    const { controller } = fixture();
    await controller.register(
      "company-a",
      { authorization: "Bearer spike:user-a" },
      {
        name: "Company A application",
        repositoryUrl: "https://example.test/a",
        idempotencyKey: "company-a-request",
      },
    );
    await controller.register(
      "company-b",
      { authorization: "Bearer spike:user-b" },
      {
        name: "Company B application",
        repositoryUrl: "https://example.test/b",
        idempotencyKey: "company-b-request",
      },
    );

    expect(
      (
        await controller.list("company-a", {
          authorization: "Bearer spike:user-a",
        })
      ).map((application) => application.name),
    ).toEqual(["Company A application"]);
  });

  it("allows a stored platform operator grant to access either company", async () => {
    const { controller } = fixture();
    await expect(
      controller.list("company-a", {
        authorization: "Bearer spike:operator-a",
        "x-spike-role": "company-user",
      }),
    ).resolves.toEqual([]);
    await expect(
      controller.list("company-b", {
        authorization: "Bearer spike:operator-a",
      }),
    ).resolves.toEqual([]);
  });

  it("rejects a disabled company membership", async () => {
    const { controller } = fixture();
    await expectStatus(
      controller.list("company-a", {
        authorization: "Bearer spike:disabled-user",
      }),
      403,
    );
  });

  it("allows ordinary reads but requires step-up assurance for application administration", async () => {
    const audit = new InMemoryAuditRepository();
    const passwordOnlyVerifier: AccessTokenVerifier = {
      async verify() {
        return {
          issuer: "https://identity.example.test",
          subject: "user-a",
          authenticationMethods: ["pwd"],
        };
      },
    };
    const controller = new AppController(
      new ApplicationService(new InMemoryApplicationRepository(audit), audit),
      new IdentityService(
        passwordOnlyVerifier,
        new InMemoryAuthorizationRepository([
          { subject: "user-a", companyId: "company-a" },
        ]),
        [],
        ["otp"],
      ),
    );

    await expect(controller.list("company-a", { authorization: "Bearer ignored" })).resolves.toEqual([]);
    await expectStatus(
      controller.register(
        "company-a",
        { authorization: "Bearer ignored" },
        {
          name: "Sensitive administration",
          repositoryUrl: "https://example.test/sensitive",
          idempotencyKey: "sensitive-request",
        },
      ),
      401,
    );
  });
});
