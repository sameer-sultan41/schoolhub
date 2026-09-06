import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import type { ApiClient } from "@schoolhub/api-client";
import type { AuthenticatedUser, LoginCredentials } from "@schoolhub/types";
import { SESSION_COOKIE_NAME } from "@/constants";
import { buildUser } from "@/data/factories";
import { env } from "@/env";
import { createLiveSession } from "@/lib/live-api";
import { E2E_OTHER_ADMIN_EMAIL } from "@/lib/seed-constants";
import { MockApi, authModule, dashboardHomeModule, tenantModule } from "@/mocks";
import {
  DashboardPage,
  LoginPage,
  PromotionBatchPage,
  PublicSitePage,
  StaffPage,
  StudentDetailPage,
  StudentFormPage,
  WeekGridPage,
} from "@/pages";

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

/**
 * A second browser identity, signed in on its own context — page plus the page objects a
 * two-actor journey drives. Extend it as more such journeys need more screens.
 */
export interface SecondIdentity {
  page: Page;
  dashboardPage: DashboardPage;
  promotionBatchPage: PromotionBatchPage;
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
  staffPage: StaffPage;
  publicSitePage: PublicSitePage;
  studentFormPage: StudentFormPage;
  studentDetailPage: StudentDetailPage;
  promotionBatchPage: PromotionBatchPage;
  weekGridPage: WeekGridPage;
  /**
   * Signs a **second** identity in, on its own browser context, and hands back that
   * context's page objects.
   *
   * Approval workflows are two-actor by design — academics.md §7.2's approver may not be
   * the preparer, and the same shape recurs in student transfers and HR leave — so a
   * journey has to hold two authenticated sessions at once. Two contexts rather than
   * sign-out/sign-in in one: the first identity stays signed in while the second acts, so
   * the journey costs two real logins instead of three (`AuthEndpointThrottle` allows 10
   * requests/minute per IP across login/refresh/logout — see e2e/AGENTS.md).
   *
   * The context starts with no storage state, so it never inherits the `live` project's
   * `storageState` file, and it is closed when the test ends.
   */
  signInAsSecondIdentity: (credentials: LoginCredentials) => Promise<SecondIdentity>;
}

export interface E2EWorkerFixtures {
  /**
   * A real, authenticated `ApiClient` against the live API — one login for the whole
   * worker (see `@/lib/live-api`'s docstring for why: `AuthEndpointThrottle` allows only
   * 10 requests/minute per IP across login/refresh/logout). Live API specs destructure
   * this instead of authenticating themselves.
   */
  liveApiClient: ApiClient;
  /**
   * The same, authenticated as the **other** tenant's real admin
   * (`E2E_OTHER_ADMIN_EMAIL`) — the second identity every cross-tenant isolation probe
   * needs to prove a real row is 404 rather than 403.
   *
   * Worker-scoped for the same reason `liveApiClient` is: each spec file that probes
   * isolation would otherwise burn its own login out of the 10/min budget, and there are
   * now three of them (campuses, academics curriculum, academics allocations). Lazy —
   * a worker that never destructures it never logs in.
   */
  liveOtherTenantApiClient: ApiClient;
}

export const test = base.extend<E2EOptions & E2EFixtures, E2EWorkerFixtures>({
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

  signedIn: async ({ page, mockApi, authUser }, use) => {
    // tenant + dashboard home: every authenticated page fetches the tenant as chrome
    // (AppShell branding), and any test that lands on /dashboard fetches the home
    // screen's own reads, regardless of which specific screen it is exercising.
    mockApi.use(authModule({ user: authUser }), tenantModule(), dashboardHomeModule());
    // Set directly rather than through a login round-trip: these tests start already
    // authenticated, so no /auth/login response exists for the side effect to hang off.
    // The cookie is presence-only — the dashboard proxy reads nothing out of it.
    await page
      .context()
      .addCookies([{ name: SESSION_COOKIE_NAME, value: "e2e-session", url: env.DASHBOARD_URL }]);
    await use(authUser);
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  staffPage: async ({ page }, use) => {
    await use(new StaffPage(page));
  },

  publicSitePage: async ({ page }, use) => {
    await use(new PublicSitePage(page));
  },

  studentFormPage: async ({ page }, use) => {
    await use(new StudentFormPage(page));
  },

  studentDetailPage: async ({ page }, use) => {
    await use(new StudentDetailPage(page));
  },

  promotionBatchPage: async ({ page }, use) => {
    await use(new PromotionBatchPage(page));
  },

  weekGridPage: async ({ page }, use) => {
    await use(new WeekGridPage(page));
  },

  signInAsSecondIdentity: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];

    await use(async (credentials) => {
      // `baseURL` is a project `use` option applied by Playwright's own `context`
      // fixture, not by `browser.newContext()` — a context created here has none unless
      // it is passed explicitly, and every relative `page.goto` would then throw.
      const context = await browser.newContext({
        baseURL: env.DASHBOARD_URL,
        storageState: { cookies: [], origins: [] },
      });
      contexts.push(context);

      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.signIn(credentials);
      return {
        page,
        dashboardPage: new DashboardPage(page),
        promotionBatchPage: new PromotionBatchPage(page),
      };
    });

    for (const context of contexts) {
      await context.close();
    }
  },

  liveApiClient: [
    // Playwright parses this function's source to learn which fixtures it depends on, so
    // the first parameter must literally be an (empty) destructuring pattern — a named
    // parameter like `_workerFixtures` breaks that detection at runtime.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const client = await createLiveSession();
      await use(client);
    },
    { scope: "worker" },
  ],

  liveOtherTenantApiClient: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const client = await createLiveSession({
        identifier: E2E_OTHER_ADMIN_EMAIL,
        // Both seeded admins share one password — seed_e2e_data.py sets both from
        // E2E_LIVE_ADMIN_PASSWORD, the same env var `env.LIVE_ADMIN_PASSWORD` reads.
        password: env.LIVE_ADMIN_PASSWORD,
      });
      await use(client);
    },
    { scope: "worker" },
  ],
});

export { expect };
