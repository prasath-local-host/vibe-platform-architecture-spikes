import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationRuntime } from "../src/persistence.js";

afterEach(() => vi.unstubAllEnvs());
describe("supply-chain configuration", () => {
  it.each(["production", "test"])("rejects missing scanner configuration when required in %s", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("SUPPLY_CHAIN_SCANNING_ENABLED", mode === "production" ? "false" : "true");
    vi.stubEnv("TRIVY_SCANNER_IMAGE", "");
    vi.stubEnv("TRIVY_SCANNER_NETWORK", "");
    vi.stubEnv("SUPPLY_CHAIN_EVIDENCE_ROOT", "");
    await expect(createApplicationRuntime(undefined)).rejects.toThrow("Supply-chain scanning requires");
  });
});
