import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { E2E_SCHOOL_ADMIN_EMAIL } from "@/lib/seed-constants";

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
 * **This file used to pin a broken screen.** The home page fetched
 * `GET /reports/dashboard-summary`, which does not exist — `apps/api/config/api_v1.py`
 * routes no reporting app — so against a real API it 404'd and the whole tile grid was
 * replaced by a red error alert, and this test asserted that alert was visible. The
 * screen has been rebuilt on endpoints that actually ship, so the assertions below are
 * the inverse: the panels render, and there is no alert on the page at all.
 *
 * `school_admin`, not the all-permissions `school_owner` this file used to sign in as.
 * Every panel on this screen is permission-gated, and a role that holds every key can
 * only ever prove that they all render — it cannot prove that the ones a role does *not*
 * hold stay hidden. `seed_e2e_data.py` gives this identity `students.student.create` and
 * `timetable.slot.create` but deliberately neither `staff.staff.create` nor
 * `students.student.import`, which is exactly the asymmetry the quick-action assertions
 * below rest on.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("dashboard home", () => {
  test("renders the panels a school_admin can answer for, and no error alert", async ({
    page,
    loginPage,
    dashboardPage,
  }) => {
    await loginPage.goto();
    await loginPage.signIn({
      identifier: E2E_SCHOOL_ADMIN_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");

    await expect(dashboardPage.heading).toBeVisible();
    await expect(dashboardPage.heading).toHaveText("Dashboard");

    // The band: the one bold element, and the greeting that identifies whose day it is.
    // The seeded tenant has a bell schedule, so the strip has blocks to draw even for an
    // identity with no teaching slots of its own.
    await expect(page.getByText("Welcome back,")).toBeVisible();
    await expect(page.getByRole("list", { name: "Today's schedule" })).toBeVisible();

    // The permission-gated panels this identity holds the keys for.
    await expect(page.getByText("Teaching load this week")).toBeVisible();
    await expect(page.getByText("Places by class")).toBeVisible();
    await expect(page.getByText("Waiting on you")).toBeVisible();
    await expect(page.getByText("Your school at a glance")).toBeVisible();

    // Quick actions are filtered by what this role can actually finish — the two it
    // cannot are the point of asserting the two it can.
    await expect(page.getByRole("link", { name: "New student" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Build timetable" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New staff member" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import students" })).toHaveCount(0);

    // Real counts from real endpoints. `Classes` drains a bounded list; `Students` reads
    // `meta.pagination.total_count`, which `CountedCursorPagination` now emits.
    await expect(page.getByText("Classes", { exact: true })).toBeVisible();
    await expect(page.getByText("Students", { exact: true })).toBeVisible();

    // The regression this file exists for: nothing on this screen 404s any more, so
    // nothing announces itself as an error. `Alert` takes `role="alert"` only for
    // `variant="danger"`, so this is exactly "no failure is being reported".
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
