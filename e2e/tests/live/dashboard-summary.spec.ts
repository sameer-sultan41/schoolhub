import { env } from "@/env";
import { expect, test } from "@/fixtures";
import {
  E2E_BASELINE_TEACHER_NAME,
  E2E_SCHOOL_ADMIN_EMAIL,
  E2E_SCHOOL_ADMIN_NAME,
} from "@/lib/seed-constants";

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
 * **History.** This file first pinned a broken screen: the home fetched
 * `GET /reports/dashboard-summary`, which does not exist, so against a real API the tile
 * grid was replaced by a red error alert and the test asserted that alert. A later rebuild
 * (commit `032d8280`: a now band, quick actions, a "Teaching load this week" panel) was
 * meant to fix that and this file was rewritten for it, but that rebuild never reached
 * `main`. `main`'s `/dashboard` is `shell/dashboard/dashboard-page-content.tsx` (the
 * Metronic Demo1 layout wired to real endpoints), so this spec asserts that screen.
 *
 * Every assertion below is content only loaded data produces, because a widget that fails
 * to load still renders its card and its heading: the greeting needs `/auth/me`, the staff
 * row needs `/staff`, and a headline stat needs a number from the overview counts, never the
 * `—` placeholder. There is deliberately no `role="alert"` count: Next's route announcer
 * carries that role too, so it is never zero.
 *
 * `school_admin`, not the all-permissions `school_owner`: a role that holds every key can
 * only prove that everything renders. `seed_e2e_data.py` gives this identity the read keys
 * these widgets call (students, staff, classes, campuses), so a missing key would surface
 * here as a widget showing an error instead of data.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** Headline stat labels, as `ChannelStats` prints them. */
const HEADLINE_STATS = ["Enrolled students", "Staff members", "Classes", "Campuses"] as const;

test.describe("dashboard home", () => {
  test("renders loaded data from the real endpoints for a school_admin", async ({
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

    await expect(dashboardPage.heading).toHaveText("Dashboard");

    // `/auth/me` loaded: the greeting carries the user's full name only on success.
    await expect(dashboardPage.welcomeHeading(E2E_SCHOOL_ADMIN_NAME)).toBeVisible();

    // `/staff` loaded and rendered a row for the seeded teacher. Searched for, because the
    // grid pages five rows at a time and the seeded row need not be on page one.
    await dashboardPage.staffSearch.fill(E2E_BASELINE_TEACHER_NAME);
    await expect(dashboardPage.staffRow(E2E_BASELINE_TEACHER_NAME)).toBeVisible();

    // The overview counts loaded: each headline card shows a number, not the `—` placeholder.
    for (const label of HEADLINE_STATS) {
      await expect(dashboardPage.statWithNumber(label), `${label} stat`).toBeVisible();
    }

    // A failed widget renders its error text in place of its data; the assertions above are
    // the proof of loading, this only catches the fallback copy next to them.
    await expect(dashboardPage.queryFallbackError).toHaveCount(0);
  });
});
