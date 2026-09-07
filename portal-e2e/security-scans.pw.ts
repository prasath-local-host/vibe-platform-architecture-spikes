import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const app = { id: "11111111-1111-4111-8111-111111111111", name: "Fixture app", repositoryUrl: "https://github.com/example/fixture", createdAt: "2026-09-01T10:00:00Z" };
const scan = { id: "22222222-2222-4222-8222-222222222222", companyId: "demo-company", entityId: "33333333-3333-4333-8333-333333333333", kind: "fs", status: "rejected", identity: "a".repeat(40), scannedAt: "2026-09-01T11:00:00Z", scannerImage: "scanner@sha256:" + "b".repeat(64), policy: "block-high-critical-unknown", componentCount: 1, findings: [{ id: "CVE-FIXTURE", severities: ["high"] }] };
const report = { bomFormat: "CycloneDX", specVersion: "1.6", components: [{ name: "fixture" }], vulnerabilities: [{ id: "CVE-FIXTURE", description: "Full report field retained", ratings: [{ severity: "high", method: "CVSSv3" }] }] };

test("reviews blocked findings, downloads the complete SBOM, and clears customer context", async ({ page }, testInfo) => {
  await page.route("**/auth/session", route => route.fulfill({ json: { subject: "test-operator", displayName: "Test operator", csrfToken: "fixture" } }));
  await page.route("**/companies/**", route => {
    const path = new URL(route.request().url()).pathname;
    const otherCompany = path.includes("/other-company/");
    const json = path.endsWith("/applications") ? [app] : path.endsWith("/assessments") ? [] : path.endsWith(`/security-scans/${scan.id}`) ? { ...scan, report } : otherCompany ? [] : [scan];
    return route.fulfill({ json });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Continue to portal" }).click();
  await page.getByRole("button", { name: /Fixture app/ }).click();
  const panel = page.getByRole("region", { name: "Security scans" });
  await panel.getByRole("button", { name: /Dependencies Blocked/ }).click();
  await expect(panel.getByText("CVE-FIXTURE", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download SBOM" }).click();
  const download = await downloadPromise;
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(report);
  await panel.screenshot({ path: testInfo.outputPath("security-scans.png") });
  await page.getByLabel("Customer", { exact: true }).fill("other-company");
  await page.getByRole("button", { name: "Open customer" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: /Fixture app/ }).click();
  await expect(panel.getByText(/No saved scans/)).toBeVisible();
  await expect(panel.getByText("CVE-FIXTURE")).toHaveCount(0);
});

test("shows an actionable scan error and recovers on refresh", async ({ page }) => {
  let fail = true;
  await page.route("**/auth/session", route => route.fulfill({ json: { subject: "test", displayName: "Test", csrfToken: "fixture" } }));
  await page.route("**/companies/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/security-scans") && fail) return route.fulfill({ status: 503, json: { message: "Unavailable" } });
    return route.fulfill({ json: path.endsWith("/applications") ? [app] : [] });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Continue to portal" }).click();
  await page.getByRole("button", { name: /Fixture app/ }).click();
  const panel = page.getByRole("region", { name: "Security scans" });
  await expect(panel.getByRole("alert")).toContainText("Unable to load security scans");
  fail = false;
  await panel.getByRole("button", { name: "Refresh scans" }).click();
  await expect(panel.getByText(/No saved scans/)).toBeVisible();
});
