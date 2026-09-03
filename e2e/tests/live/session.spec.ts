import { SESSION_COOKIE_NAME } from "@/constants";
import { expect, test } from "@/fixtures";

/**
 * Live lane — requires the real stack, seeded (see `tests/live/tenant-isolation.spec.ts`'s
 * header comment for the run command).
 *
 * Uses the shared `live-setup` session (see `live.setup.ts`) — every test here starts
 * already signed in, so it costs no extra `/auth/login` call against the throttle.
 */
test.describe("session (real API)", () => {
  test("signing out revokes the session, not just the current tab", async ({
    page,
    dashboardPage,
  }) => {
    await dashboardPage.goto();
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
    // brand-new browser context and try the protected route with them. If the server
    // actually revoked the refresh token, restoring a session still fails and this
    // redirects to /login; if sign-out only cleared the one tab's client state, this
    // would authenticate.
    const browser = page.context().browser();
    if (!browser) throw new Error("expected a real Browser instance for a fresh context");
    const replayContext = await browser.newContext();
    try {
      await replayContext.addCookies([refreshCookie, sessionCookie]);
      const replayPage = await replayContext.newPage();
      await replayPage.goto("/dashboard");
      await expect(replayPage).toHaveURL("/login");
    } finally {
      await replayContext.close();
    }
  });
});
