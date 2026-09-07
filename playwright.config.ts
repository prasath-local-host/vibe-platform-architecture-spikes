import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./portal-e2e",
  testMatch: "**/*.pw.ts",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5178/portal/",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
    viewport: { width: 1440, height: 1100 },
  },
  webServer: {
    command: "pnpm exec vite --config portal/vite.config.ts --port 5178 --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:5178/portal/",
    reuseExistingServer: false,
  },
});
