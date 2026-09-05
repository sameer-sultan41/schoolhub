import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { seedTimetableGrid } from "@/lib/live-timetable-grid";
import { E2E_BASELINE_TEACHER_NAME, E2E_SCHOOL_ADMIN_EMAIL } from "@/lib/seed-constants";

/**
 * Live lane — requires the real stack, seeded (`seed_e2e_data`; see
 * `tests/live/tenant-isolation.spec.ts`'s header for the run command).
 *
 * timetable.md §5.5's central promise as one real person at one desk: **a draft is
 * allowed to be wrong, and publish is where that stops.** The admin builds two cells,
 * one of which schedules a teacher for a subject nobody allocated them to, runs the
 * conflict check, fixes the cell, and publishes — and the published grid reads back.
 *
 * `teacher_not_allocated` is the clash on purpose. It is the only *hard* conflict a user
 * can both create and undo from the grid alone: a break cell is not clickable, a
 * double-booked section is impossible when each cell holds one slot, and a double-booked
 * teacher or room needs a second section this journey has no reason to build. It is also
 * the one that matters most across modules — scheduling a teacher for a subject they
 * hold no allocation for is the timetable contradicting academics, and examinations
 * derives marks-entry rights from that same allocation.
 *
 * **The grid's data is set up through the API** (`seedTimetableGrid`), not the UI: a
 * publishable cell needs a session, a class, a section, a subject in that class's
 * curriculum and a teacher allocated to it, which is the academics journey with a
 * timetable bolted on. What the browser proves is the part only the browser can — that
 * the conflict the server reports is the one the user is shown, and that fixing it in
 * the product really does unblock the publish button.
 *
 * It builds a **run-unique** section rather than using the seeded one, and that is not
 * tidiness: `publish_section_timetable` end-dates every currently published slot of the
 * section it publishes, so publishing into the seeded section would supersede the seeded
 * week and leave every later run reading a grid the seed no longer describes.
 *
 * Auth budget (`AuthEndpointThrottle`: 10 requests/minute per IP across
 * login/refresh/logout — e2e/AGENTS.md): **one** browser login and one refresh. The
 * refresh is the single `page.reload()` at the end, which re-boots the app with an empty
 * in-memory access token; reaching the screen costs nothing extra because the navigation
 * to `/timetable` goes through the nav link (client-side) rather than `page.goto`, the
 * same economy `students-admission-enrollment.spec.ts` documents. The worker-scoped
 * `liveApiClient` this shares with the API lane adds no login of its own.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const MONDAY = "Monday";
const TUESDAY = "Tuesday";

test.describe("timetable build -> validate -> publish (real API, school_admin)", () => {
  test("an admin fixes a reported clash and publishes the week", async ({
    page,
    loginPage,
    dashboardPage,
    weekGridPage,
    liveApiClient,
  }) => {
    const grid = await seedTimetableGrid(liveApiClient);
    const period = grid.periods[0];
    if (!period) throw new Error("expected a seeded schedulable period");

    // --- 1. Sign in and reach the grid. ---
    await loginPage.goto();
    await loginPage.signIn({
      identifier: E2E_SCHOOL_ADMIN_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");
    // The permission-gated nav renders only after the dashboard's own data loads —
    // clicking an entry before that races an empty nav (the same wait the admission
    // journey documents). That this entry exists at all is the first assertion of the
    // seeded permission set: `canAccessModule` shows it only for a user holding some
    // `timetable.*` key.
    await expect(dashboardPage.heading).toBeVisible();
    await dashboardPage.navLink("Timetable").click();
    await expect(weekGridPage.heading).toBeVisible();

    await weekGridPage.selectSession(grid.sessionName);
    await weekGridPage.selectSection(grid.sectionName);

    // --- 2. Two draft cells: one clean, one scheduling the teacher for a subject
    // nobody allocated them to. Both save — §5.5 draws the line at publish, not at
    // save, because an admin who cannot save an in-progress grid cannot build one. ---
    await weekGridPage.fillCellWith({
      weekday: MONDAY,
      periodName: period.name,
      subjectName: grid.allocatedSubjectName,
      teacherName: E2E_BASELINE_TEACHER_NAME,
    });
    await expect(weekGridPage.filledCell(MONDAY, period.name)).toContainText("Draft");

    await weekGridPage.fillCellWith({
      weekday: TUESDAY,
      periodName: period.name,
      subjectName: grid.unallocatedSubjectName,
      teacherName: E2E_BASELINE_TEACHER_NAME,
    });
    await expect(weekGridPage.filledCell(TUESDAY, period.name)).toContainText("Draft");

    // The per-edit check rides on the write itself (`meta.conflicts` on every slot
    // mutation, §16), so the panel is already populated before anything is validated.
    await expect(
      weekGridPage.conflictPanel.getByText(/no allocation for this section and subject/i),
    ).toBeVisible();

    // --- 3. The full run over the section. ---
    await weekGridPage.validate.click();
    await expect(
      weekGridPage.conflictPanel.getByText(/no allocation for this section and subject/i),
    ).toBeVisible();
    // Blocking, not a warning — which is what makes the next step necessary rather
    // than optional.
    await expect(weekGridPage.conflictPanel.getByText("Blocking", { exact: true })).toBeVisible();

    // --- 4. Fix it the way the product offers: move the cell onto the subject this
    // teacher is actually allocated to, rather than clearing the teacher. ---
    await weekGridPage.changeCellSubject({
      weekday: TUESDAY,
      periodName: period.name,
      subjectName: grid.allocatedSubjectName,
    });

    await weekGridPage.validate.click();
    // The panel is gone, and the run says so in its own words. Both are asserted
    // because they come from different places: the list disappears when the findings
    // are empty, while "No conflicts found." is rendered only once a validation run has
    // *succeeded* — so together they say the full-section run agreed with the per-edit
    // check, which is exactly the precondition `:publish` is about to re-run.
    await expect(weekGridPage.conflictPanel).toHaveCount(0);
    await expect(weekGridPage.noConflicts).toBeVisible();

    // --- 5. Publish. ---
    await weekGridPage.publish.click();
    await expect(weekGridPage.publishedSummary(2)).toBeVisible();
    await expect(weekGridPage.filledCell(MONDAY, period.name)).toContainText("Published");
    await expect(weekGridPage.filledCell(TUESDAY, period.name)).toContainText("Published");

    // --- 6. The published grid reads back after a cold boot. ---
    // The badge flip above is already a real server read (the publish invalidates the
    // module's queries and the grid re-fetches), but it shares a warm query cache with
    // the write that caused it. A reload starts a new query client against a new app
    // instance, so what renders here came from the database and nothing else. It is the
    // one refresh this spec spends — see the header's auth budget.
    await page.reload();
    await expect(weekGridPage.heading).toBeVisible();
    await weekGridPage.selectSession(grid.sessionName);
    await weekGridPage.selectSection(grid.sectionName);

    await expect(weekGridPage.filledCell(MONDAY, period.name)).toContainText("Published");
    await expect(weekGridPage.filledCell(TUESDAY, period.name)).toContainText("Published");
    // A republished cell would be a *new* row and the old one end-dated; nothing here
    // republished, so the week is still the two cells that went live.
    await expect(weekGridPage.filledCell(MONDAY, period.name)).toContainText(
      grid.allocatedSubjectName,
    );
  });
});
