import { test as setup } from "@/fixtures";
import { env } from "@/env";

/**
 * Runs once per `pnpm e2e:live` invocation (the `live-setup` project), before every
 * `live` test — see `playwright.config.ts`'s `dependencies: ["live-setup"]`.
 *
 * One real login, cached to a `storageState` file, for a `live` test to reuse instead of
 * logging in for itself: `AuthEndpointThrottle` (apps/api/core/api/throttling.py) allows
 * only 10 requests/minute per IP across login/refresh/logout combined.
 *
 * IMPORTANT — safe for at most ONE browser test that does a cold, session-restoring
 * navigation (e.g. `dashboardPage.goto()`). Refresh tokens *rotate*
 * (`core/rbac/views.py::RefreshView`): the first such test's cold-load refresh call
 * invalidates this file's `sh_refresh` cookie for every *other* test that still expects
 * to reuse it — confirmed against the real API, not assumed, when a second consumer's own
 * refresh 401'd with the token family already rotated away. `fullyParallel` gives no
 * guaranteed file-execution order to make "the first one" reliable, either. In practice
 * this means: don't add a second live browser spec that reuses this file's storageState
 * and also does its own cold navigation — give it a real login instead (see
 * `tests/live/session.spec.ts`'s header for the pattern). Every current live browser spec
 * does its own real login for exactly this reason; nothing consumes this file's
 * storageState today. It stays wired up for a genuine future use case that doesn't
 * trigger its own refresh (e.g. an already-authenticated context that never navigates
 * cold), and to keep the `live-setup`/`live` project split's throttle-avoidance pattern
 * available without rebuilding it from scratch.
 *
 * Tests that need to exercise the login form itself (e.g. `tests/live/login.spec.ts`)
 * opt out with `test.use({ storageState: { cookies: [], origins: [] } })` — same as every
 * other live browser spec now does.
 */
setup("authenticate the live-lane admin once", async ({ page, loginPage }) => {
  await loginPage.goto();
  await loginPage.signIn({
    identifier: env.LIVE_ADMIN_IDENTIFIER,
    password: env.LIVE_ADMIN_PASSWORD,
  });

  await page.waitForURL("/dashboard");
  await page.context().storageState({ path: ".auth/live-admin.json" });
});
