import { test, expect } from "@playwright/test";

test("portal gates Stage and confirms Prod using the same build", async ({ page }, testInfo) => {
  const app = { id: "11111111-1111-4111-8111-111111111111", name: "Demo delivery", repositoryUrl: "https://github.com/example/demo", createdAt: new Date().toISOString() };
  const sha = "a".repeat(40);
  const runs: any[] = [];
  const commands: any[] = [];
  await page.route("**/auth/session", route => route.fulfill({ json: { subject: "operator", displayName: "Operator", csrfToken: "test-csrf" } }));
  await page.route("**/companies/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/demo-pipeline/source")) return route.fulfill({ json: { sourceRevision: sha } });
    if (path.endsWith("/demo-pipeline")) {
      if (route.request().method() === "POST") {
        expect(route.request().headers()["x-csrf-token"]).toBe("test-csrf");
        const body = route.request().postDataJSON(); commands.push(body);
        const run = { id: `run-${commands.length}`, kind: body.kind, sourceRevision: sha, buildId: body.buildId ?? null, status: "queued", conclusion: null, createdAt: new Date().toISOString(), url: "https://github.com/example/platform/actions/runs/1" };
        runs.unshift(run);
        return route.fulfill({ status: 202, json: run });
      }
      return route.fulfill({ json: { configured: true, runs } });
    }
    return route.fulfill({ json: path.endsWith("/applications") ? [app] : [] });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Continue to portal" }).click();
  await page.getByRole("button", { name: /Demo delivery/ }).click();
  const panel = page.getByRole("region", { name: "Build and deployments" });
  await expect(panel.getByRole("button", { name: "Deploy to Stage" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Promote to Prod" })).toBeDisabled();
  await panel.getByRole("button", { name: "Use latest main" }).click();
  await panel.getByRole("button", { name: "Build, test & scan" }).click();
  await expect(panel.getByText("queued", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Deploy to Stage" })).toBeDisabled();
  Object.assign(runs[0], { status: "completed", conclusion: "success" });
  await panel.getByRole("button", { name: "Refresh pipeline" }).click();
  await panel.getByRole("button", { name: "Deploy to Stage" }).click();
  await expect(panel.getByRole("button", { name: "Promote to Prod" })).toBeDisabled();
  Object.assign(runs[0], { status: "completed", conclusion: "success" });
  await panel.getByRole("button", { name: "Refresh pipeline" }).click();
  await panel.getByRole("button", { name: "Promote to Prod" }).click();
  expect(commands).toHaveLength(2);
  await panel.getByRole("button", { name: "Confirm Prod deployment" }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[0]).toMatchObject({ kind: "build", sourceRevision: sha });
  expect(commands[1]).toMatchObject({ kind: "stage", buildId: "run-1" });
  expect(commands[2]).toMatchObject({ kind: "prod", buildId: "run-1" });
  await panel.screenshot({ path: testInfo.outputPath("demo-pipeline.png") });
});

test("step-up response offers identity verification without redispatch", async ({ page }) => {
  const app = { id: "11111111-1111-4111-8111-111111111111", name: "Demo app", repositoryUrl: "https://github.com/example/demo", createdAt: new Date().toISOString() };
  let posts = 0;
  await page.route("**/auth/session", route => route.fulfill({ json: { subject: "operator", displayName: "Operator", csrfToken: "test" } }));
  await page.route("**/companies/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/demo-pipeline") && route.request().method() === "POST") { posts++; return route.fulfill({ status: 401, json: { message: "Step-up authentication is required for release.create" } }); }
    return route.fulfill({ json: path.endsWith("/applications") ? [app] : path.endsWith("/demo-pipeline") ? { configured: true, runs: [] } : [] });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Continue to portal" }).click();
  await page.getByRole("button", { name: /Demo app/ }).click();
  const panel = page.getByRole("region", { name: "Build and deployments" });
  await panel.getByLabel("Source commit (main)").fill("a".repeat(40));
  await panel.getByRole("button", { name: "Build, test & scan" }).click();
  await expect(panel.getByRole("button", { name: "Verify identity" })).toBeVisible();
  expect(posts).toBe(1);
});
