import { test as base, expect } from "@playwright/test";
import type { AuthenticatedUser } from "@schoolhub/types";
import { SESSION_COOKIE_NAME } from "@/constants";
import { buildUser } from "@/data/factories";
import { env } from "@/env";
import { MockApi, authModule, tenantModule } from "@/mocks";
import { DashboardPage, LoginPage, PublicSitePage } from "@/pages";

/**
 * The single import surface for every spec:
 *
 * ```ts
 * import { expect, test } from "@/fixtures";
 * ```
 *
 * Adding a capability means adding a fixture here, not a helper call in each spec.
 * Fixtures are lazy — a spec pays only for what it destructures.
 */

export interface E2EOptions {
  /**
   * User the `signedIn` fixture authenticates as. Override per file or per describe:
   * `test.use({ authUser: buildUserWithoutPermissions() })`.
   */
  authUser: AuthenticatedUser;
}

export interface E2EFixtures {
  /** Stub router for browser-side API traffic. Already installed on `page`. */
  mockApi: MockApi;
  /**
   * Puts the browser in a signed-in state: session cookie set, `/auth/*` and `/tenant`
   * stubbed for `authUser`. Destructure it to opt in; it does nothing otherwise.
   */
  signedIn: AuthenticatedUser;
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  publicSitePage: PublicSitePage;
}

export const test = base.extend<E2EOptions & E2EFixtures>({
  authUser: [buildUser(), { option: true }],

  mockApi: async ({ page }, use) => {
    const api = new MockApi();
    await api.install(page);

    // The one effect the stub router cannot reproduce on its own: the real API sets the
    // `sh_session` cookie on the dashboard's domain when a login succeeds, and the auth
    // proxy routes on its presence. Without this, a successful sign-in would bounce
    // straight back to /login and the redirect could never be asserted.
    page.on("response", (response) => {
      if (!response.ok()) return;
      const context = page.context();
      // Swallowed: the context can close mid-flight at the end of a test, and the
      // assertion that follows is what should report a real failure.
      const ignore = () => {};

      if (response.url().includes("/auth/login")) {
        void context
          .addCookies([
            { name: SESSION_COOKIE_NAME, value: "e2e-session", url: env.DASHBOARD_URL },
          ])
          .catch(ignore);
      } else if (response.url().includes("/auth/logout")) {
        // Symmetric to login: without clearing it the proxy would still see a session
        // and bounce the signed-out user straight back into the app.
        void context.clearCookies({ name: SESSION_COOKIE_NAME }).catch(ignore);
      }
    });

    await use(api);
  },

  signedIn: async ({ page, mockApi, authUser }, use) => {
    mockApi.use(authModule({ user: authUser }), tenantModule());
    // Presence-only hint the dashboard proxy reads to route an anonymous visitor to
    // /login. The real cookie is set by the API; authenticity is the live lane's job.
    await page.context().addCookies([
      { name: SESSION_COOKIE_NAME, value: "e2e-session", url: env.DASHBOARD_URL },
    ]);
    await use(authUser);
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  publicSitePage: async ({ page }, use) => {
    await use(new PublicSitePage(page));
  },
});

export { expect };
