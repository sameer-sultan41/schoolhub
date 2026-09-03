import { expect, test } from "@/fixtures";

/**
 * Live lane — requires the real stack, seeded (see `tests/live/tenant-isolation.spec.ts`'s
 * header comment for the run command).
 *
 * Uses the shared `live-setup` session (see `live.setup.ts`).
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
test.describe("dashboard summary", () => {
  test("renders the heading and degrades honestly while the reporting API does not exist", async ({
    page,
    dashboardPage,
  }) => {
    await dashboardPage.goto();

    await expect(dashboardPage.heading).toBeVisible();
    await expect(dashboardPage.heading).toHaveText("Dashboard");
    await expect(
      page.getByRole("alert").filter({ hasText: "We could not find what you were looking for." }),
    ).toBeVisible();
  });
});
