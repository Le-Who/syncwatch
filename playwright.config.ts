import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import path from "path";

delete process.env.NO_COLOR;
loadEnvConfig(path.resolve(__dirname, "./"));
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "html",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    actionTimeout: 10000,
    navigationTimeout: 15000,
    launchOptions: {
      args: [
        "--use-gl=egl",
        "--disable-dev-shm-usage",
        "--disable-gpu", // Fallback for pure headless
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
  ],
  webServer: {
    command: "pnpm exec tsx server.ts",
    port: 3001,
    env: {
      PORT: "3001",
      BROWSERSLIST_IGNORE_OLD_DATA: "true",
    },
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
