import { env } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Live lane — requires the real stack, seeded (see `tests/live/tenant-isolation.spec.ts`'s
 * header comment for the run command).
 *
 * Real login, guest context — not the shared `live-setup` session. Refresh tokens
 * *rotate*, so this test's own cold `/dashboard` visit would invalidate the shared
 * session's one refresh cookie for every other test that still expects to reuse it (a
 * second consumer's own refresh 401'd with the family already rotated away, confirmed
 * against the real API). Exactly one browser test may ever consume that shared cookie's
 * refresh per run, and `fullyParallel` gives no guaranteed ordering to make that "one"
 * reliable — so this test owns its session end to end instead. See
 * `tests/live/session.spec.ts`'s header for the same reasoning in more detail.
 *
 * BLOCKED on a backend endpoint that does not exist yet: `apps/api/config/api_v1.py`
 * routes only `core.rbac` and `apps.school_organization` — there is no reporting app, so
 * `GET /reports/dashboard-summary` (what `DashboardSummary` fetches,
 * apps/dashboard/src/features/dashboard/dashboard-summary.tsx) 404s against the real API.
 * The page never crashes on that — it degrades to a real error alert instead of stat
 * tiles. This pins that real, current behavior rather than inventing tile data that does
 * not exist. Once the reporting endpoint ships, replace the alert assertion below with
 * real assertions against seeded numbers, and delete this comment.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("dashboard summary", () => {
  test("renders the heading and degrades honestly while the reporting API does not exist", async ({
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
    await expect(dashboardPage.heading).toHaveText("Dashboard");
    await expect(
      page.getByRole("alert").filter({ hasText: "We could not find what you were looking for." }),
    ).toBeVisible();
  });
});
