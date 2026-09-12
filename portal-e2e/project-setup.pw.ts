import { test, expect } from "@playwright/test";

test("company organization onboarding, verification and VCP repository creation", async ({ page }, testInfo) => {
  let organization: { slug: string; status: string } | null = null;
  const projects: unknown[] = [];
  const apps: unknown[] = [];
  const submissions: Record<string, unknown>[] = [];
  await page.route("**/auth/session", route => route.fulfill({ json: { subject: "operator", displayName: "Operator", csrfToken: "fixture" } }));
  await page.route("**/companies/**", async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("fixture");
      const body = request.postDataJSON() as Record<string, unknown>; submissions.push(body);
      if (path.endsWith("/organization/approve")) organization!.status = "verified";
      else if (path.endsWith("/organization")) organization = { slug: String(body.slug), status: "pending" };
      else if (path.endsWith("/projects")) {
        const app = { id: "test-app", name: body.name, repositoryUrl: "https://github.com/company/portal", createdAt: "2026-09-13T00:00:00Z" };
        apps.push(app); projects.push({ ...body, id: "project-1", status: "ready", repositoryUrl: app.repositoryUrl });
        return route.fulfill({ json: app });
      }
    }
    return route.fulfill({ json: path.endsWith("/applications") ? apps : { configured: true, organization, projects } });
  });
  await page.goto("./"); await page.getByRole("button", { name: "Continue to portal" }).click();
  await page.getByLabel("GitHub organization name").fill("company");
  await page.getByRole("button", { name: "Submit organization" }).click();
  await expect(page.getByText("Awaiting VCP verification", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create private repository" })).toHaveCount(0);
  await page.getByLabel("Ownership verification reference").fill("ONBOARD-42");
  await page.getByRole("button", { name: "Verify organization connection" }).click();
  await page.getByLabel("Application name", { exact: true }).fill("Customer portal");
  await page.getByLabel("Repository name", { exact: true }).fill("portal");
  await page.getByRole("button", { name: "Create private repository" }).click();
  await expect(page.getByRole("link", { name: "Open repository" })).toHaveAttribute("href", "https://github.com/company/portal");
  expect(submissions[2]).toMatchObject({ name: "Customer portal", repositoryName: "portal" });
  expect(submissions[2]).not.toHaveProperty("organizationId");
  await page.screenshot({ path: testInfo.outputPath("project-setup.png"), fullPage: true });
  await page.getByLabel("Customer", { exact: true }).fill("other-company");
  organization = null; projects.length = 0; apps.length = 0;
  await page.getByRole("button", { name: "Open customer" }).click();
  await expect(page.getByLabel("GitHub organization name")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open repository" })).toHaveCount(0);
});
