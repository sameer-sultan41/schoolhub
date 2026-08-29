import { defineConfig, devices } from "@playwright/test";
import { env } from "./src/env";

/**
 * SchoolHub end-to-end suite.
 *
 * Three projects, split by what each one actually needs to be true:
 *
 * | project     | needs                    | runs on          | covers                                   |
 * |-------------|--------------------------|------------------|------------------------------------------|
 * | `dashboard` | dashboard build only     | every PR         | auth + app flows, API stubbed in-browser |
 * | `website`   | website build only       | every PR         | host→tenant resolution, unknown-host fallback |
 * | `live`      | Postgres + Django + apps | opt-in / nightly | real auth, RLS, cross-tenant isolation   |
 *
 * The split exists because the dashboard fetches from the browser (interceptable) while the
 * website renders on the server (not interceptable) — see `src/mocks/router.ts`. Anything
 * that must prove a *server* behaviour belongs in `live`, not in a stubbed project.
 */

const isCI = Boolean(process.env.CI);

/** Public config the apps need at build and run time. */
const appEnv = {
  NEXT_PUBLIC_API_BASE_URL: env.API_BASE_URL,
  NEXT_PUBLIC_APP_URL: env.DASHBOARD_URL,
  NEXT_PUBLIC_PLATFORM_DOMAIN: env.PLATFORM_DOMAIN,
  API_BASE_URL: env.API_BASE_URL,
  WEBSITE_MACHINE_TOKEN: "e2e-machine-token",
  REVALIDATE_WEBHOOK_SECRET: "e2e-revalidate-secret",
  NEXT_TELEMETRY_DISABLED: "1",
};

/**
 * Build (turbo-cached, so a warm repeat is near-instant) then serve the standalone output.
 *
 * Not `next start`: both apps set `output: "standalone"` for their Docker image, and
 * `next start` does not serve that build — see `scripts/serve-app.sh`.
 */
function serve(app: "dashboard" | "website", url: string) {
  return {
    command: `./scripts/serve-app.sh ${app} ${new URL(url).port || "80"}`,
    url,
    env: appEnv,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  };
}

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",

  // Specs must be independent; anything that cannot run in parallel is a bug in the spec.
  fullyParallel: true,
  forbidOnly: isCI,
  // One retry in CI absorbs genuine flake; a spec that needs two is quarantined, not retried.
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: isCI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    // Artefacts only for failures — a green run should leave nothing behind.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: "dashboard",
      testDir: "./tests/dashboard",
      use: { ...devices["Desktop Chrome"], baseURL: env.DASHBOARD_URL },
    },
    {
      name: "website",
      testDir: "./tests/website",
      use: { ...devices["Desktop Chrome"], baseURL: env.WEBSITE_URL },
    },
    {
      name: "live",
      testDir: "./tests/live",
      use: { ...devices["Desktop Chrome"], baseURL: env.DASHBOARD_URL },
    },
  ],

  // `live` brings its own stack (compose), so the built-in servers cover the other two.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [serve("dashboard", env.DASHBOARD_URL), serve("website", env.WEBSITE_URL)],
});
