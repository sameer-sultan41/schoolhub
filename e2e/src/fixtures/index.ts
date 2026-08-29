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

  mockApi: async ({ page }, use, testInfo) => {
    const api = new MockApi();

    // The one effect the stub router cannot reproduce on its own: the API and the app are
    // different origins here, so a `Set-Cookie` from the API would land on the wrong host.
    // The dashboard's auth proxy routes on `sh_session`, so login must create it and logout
    // must remove it. This runs as an awaited side effect rather than a `page.on("response")`
    // listener because the app navigates the moment it sees the response — a listener loses
    // that race and the redirect is decided against a stale cookie.
    api.after(async (request, response) => {
      if (response.status >= 400) return;
      const context = page.context();
      if (request.path === "/auth/login") {
        await context.addCookies([
          { name: SESSION_COOKIE_NAME, value: "e2e-session", url: env.DASHBOARD_URL },
        ]);
      } else if (request.path === "/auth/logout") {
        await context.clearCookies({ name: SESSION_COOKIE_NAME });
      }
    });

    await api.install(page);
    await use(api);

    // A missing stub answers 418 rather than hanging, but a test can still pass while
    // quietly relying on that. Surface it — unless the test already failed, whose own
    // error is the more useful one to report.
    if (api.unmatched.length > 0 && testInfo.status === testInfo.expectedStatus) {
      throw new Error(
        `Requests reached no stub:\n  ${api.unmatched.join("\n  ")}\n` +
          "Add them to a mock module in src/mocks/domains/.",
      );
    }
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
