import { test as setup } from "@/fixtures";
import { env } from "@/env";

/**
 * Runs once per `pnpm e2e:live` invocation (the `live-setup` project), before every
 * `live` test — see `playwright.config.ts`'s `dependencies: ["live-setup"]`.
 *
 * One real login, cached to a `storageState` file the `live` project's tests reuse,
 * instead of every test logging in for itself: `AuthEndpointThrottle`
 * (apps/api/core/api/throttling.py) allows only 10 requests/minute per IP across
 * login/refresh/logout combined, which a handful of live specs would exhaust fast.
 *
 * Tests that need to exercise the login form itself (e.g. `tests/live/login.spec.ts`)
 * opt out with `test.use({ storageState: { cookies: [], origins: [] } })`.
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
