import { defineConfig, devices } from "@playwright/test";
import { ALICE_STATE, E2E_URL } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: E2E_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "auth",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "app",
      testMatch: /notes\.spec\.ts|live\.spec\.ts|shell\.spec\.ts|meta\.spec\.ts|parked\.spec\.ts|history\.spec\.ts|tags\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: ALICE_STATE },
    },
  ],
});
