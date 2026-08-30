import { defineConfig, devices } from "@playwright/test";
// Side-effect import: must run before `./src/env` parses process.env.
import "./src/load-env";
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
/**
 * Readiness path for each app.
 *
 * - Dashboard: "/" redirects to `/login` (307), which Playwright's readiness check
 *   accepts. No API dependency — the proxy only checks for a session cookie.
 * - Website: NOT "/". The proxy resolves a tenant from the Host header, and this probe
 *   dials `127.0.0.1` literally (see below) — an address that can never equal
 *   `PLATFORM_DOMAIN` ("localhost"), so "/" always classifies as an unverified custom
 *   domain, 404s once the tenant lookup misses, and 404 is not an accepted readiness
 *   status (only 2xx/3xx/400–403 are) — the probe would poll it for the full timeout
 *   while the server sat healthy the whole time. `/robots.txt` is a metadata route: it
 *   is not wrapped by the root layout, so it never calls `resolveTenant()`, and returns
 *   200 regardless of Host — confirmed with `curl` before relying on it here.
 */
const HEALTH_PATH = { dashboard: "/", website: "/robots.txt" } as const;

function serve(app: "dashboard" | "website", url: string) {
  const target = new URL(url);

  // Dial the address, not a name: `localhost` may resolve to ::1, and the server binds
  // IPv4. `baseURL` keeps the hostname, because Chromium falls back across families and
  // the website's specs need name-based hosts.
  const probe = new URL(HEALTH_PATH[app], url);
  probe.hostname = "127.0.0.1";

  return {
    command: `./scripts/serve-app.sh ${app} ${target.port || "80"}`,
    url: probe.toString(),
    env: appEnv,
    reuseExistingServer: !isCI,
    timeout: 300_000,
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
    : [
        // Must be first: the website's root layout fetches this on every request,
        // including its own readiness probe. See scripts/tenant-lookup-stub.mjs for why
        // this exists at all — MockApi cannot reach a server-side fetch.
        {
          command: "node scripts/tenant-lookup-stub.mjs",
          url: `${new URL(env.API_BASE_URL).origin}/healthz`,
          env: { API_BASE_URL: env.API_BASE_URL },
          reuseExistingServer: !isCI,
          timeout: 15_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        },
        serve("dashboard", env.DASHBOARD_URL),
        serve("website", env.WEBSITE_URL),
      ],
});
