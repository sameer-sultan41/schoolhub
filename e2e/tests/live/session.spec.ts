import { SESSION_COOKIE_NAME } from "@/constants";
import { env } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Live lane — requires the real stack, seeded (see `tests/live/tenant-isolation.spec.ts`'s
 * header comment for the run command).
 *
 * Real login, guest context — not the shared `live-setup` session. Refresh tokens
 * *rotate*, so a cold `/dashboard` visit's refresh call invalidates the shared session's
 * one refresh cookie for every other test that still expects to reuse it (confirmed
 * against the real API: a second consumer's own refresh 401'd with the family already
 * rotated away). Exactly one browser test may ever consume that shared cookie's refresh
 * per run, and `fullyParallel` gives no guaranteed ordering to make that "one" reliable —
 * so this test owns its session end to end instead.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("session (real API)", () => {
  test("signing out revokes the session, not just the current tab", async ({
    page,
    loginPage,
    dashboardPage,
  }) => {
    await loginPage.goto();
    await loginPage.signIn({
      identifier: env.LIVE_ADMIN_IDENTIFIER,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");
    await expect(dashboardPage.heading).toBeVisible();

    // Captured before sign-out: proving revocation means replaying the *real* leftover
    // cookies somewhere new, not just showing a context with no cookies at all gets
    // redirected — that would be true whether or not sign-out did anything. Both cookies
    // are needed: sh_session (non-HttpOnly, read by the proxy's route guard) gets the
    // request past routing at all; sh_refresh (HttpOnly) is what a real revocation check
    // actually invalidates server-side.
    const cookiesBeforeSignOut = await page.context().cookies();
    const refreshCookie = cookiesBeforeSignOut.find((cookie) => cookie.name === "sh_refresh");
    const sessionCookie = cookiesBeforeSignOut.find(
      (cookie) => cookie.name === SESSION_COOKIE_NAME,
    );
    if (!refreshCookie) throw new Error("expected a real sh_refresh cookie before signing out");
    if (!sessionCookie) throw new Error("expected a real sh_session cookie before signing out");

    await dashboardPage.signOut.click();
    await expect(page).toHaveURL("/login");

    // The strongest proof a stub cannot make honestly: replay those leftover cookies in a
    // brand-new browser context and try the protected route with them. Assert on the real
    // /auth/refresh response, not on where the page ends up — sh_session only gates the
    // dashboard's *proxy* (a routing decision, cookie-presence only, by design), so a
    // present-but-stale sh_session still lets the replayed context load /dashboard's page
    // chrome even once the refresh token is genuinely revoked; the page just renders
    // without a restored session rather than redirecting away, which is a separate,
    // milder UX question from the one this test actually cares about.
    const browser = page.context().browser();
    if (!browser) throw new Error("expected a real Browser instance for a fresh context");
    const replayContext = await browser.newContext();
    try {
      await replayContext.addCookies([refreshCookie, sessionCookie]);
      const replayPage = await replayContext.newPage();
      const refreshAttempt = replayPage.waitForResponse((response) =>
        response.url().endsWith("/api/auth/refresh"),
      );
      await replayPage.goto("/dashboard");
      const refreshResponse = await refreshAttempt;
      expect(refreshResponse.status()).toBe(401);
    } finally {
      await replayContext.close();
    }
  });
});
