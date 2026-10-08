import type { Page } from "@playwright/test";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import {
  E2E_BASELINE_CAMPUS_NAME,
  E2E_BASELINE_CLASS_NAME,
  E2E_BASELINE_SECTION_NAME,
  E2E_BASELINE_SESSION_NAME,
  E2E_PRINCIPAL_EMAIL,
  E2E_SCHOOL_ADMIN_EMAIL,
  E2E_SECOND_CAMPUS_NAME,
  E2E_SECOND_CAMPUS_SECTION_NAME,
} from "@/lib/seed-constants";
import type { DashboardPage, LoginPage } from "@/pages";

/**
 * Live lane — requires the real stack, seeded (`seed_e2e_data`; see
 * `tests/live/tenant-isolation.spec.ts`'s header for the run command).
 *
 * The module's own stated core risk (module doc §5-§8: "duplicate admission rate <
 * 0.5%"), end to end, as a single real actor. Real login, guest context — same reasoning
 * as `session.spec.ts`: refresh-token rotation makes the shared `live-setup` session
 * unsafe to reuse across specs.
 *
 * `school_admin`, not `admission_staff`: confirmed against the real API that the
 * emergency-contact step needs `students.student.update`
 * (`EmergencyContactLinkViewSet` reuses that key), which only `school_admin` holds —
 * see `seed_e2e_data.py`'s header comment for the full story. A single `school_admin`
 * completing this whole journey is the realistic single-actor path, not a shortcut
 * around a permission split that would force two identities.
 *
 * There is no dedicated "admit a student" endpoint — the dashboard composes it from
 * four plain calls (create student, create+link guardian, add emergency contact,
 * enroll), each gated by its own permission and its own domain rule
 * (`assert_enrollment_prerequisites` requires at least one guardian and one emergency
 * contact before `:enroll` succeeds) — so the journey below exercises exactly that
 * sequence through the real UI, not a shortcut around it.
 *
 * Every navigation after the one real sign-in is client-side (`nav` link clicks, not
 * `page.goto`) deliberately: a full page load re-boots the app with an empty in-memory
 * access token, forcing an eager refresh off the rotating `sh_refresh` cookie. This
 * journey visits `/students/new` twice (create, then re-create for the duplicate case),
 * and an earlier `page.goto("/students/new")` version of this spec was observed getting
 * bounced to `/login` mid-run on the second visit. The precise trigger wasn't pinned down
 * (a genuinely throttled `AuthEndpointThrottle` 429 from concurrent local runs was live at
 * the time), but it exposed a real, separate conflation worth fixing on its own footing:
 * `packages/api-client/src/token-store.ts`'s `refreshAccessToken()` and
 * `client.ts`'s `refreshOnce()` both collapse *any* non-2xx refresh response — a rate
 * limit or a transient 5xx included, not just an actually-expired/invalid refresh token —
 * into the same "session is over" signal that clears the access token and bounces to
 * `/login`. Avoiding a second cold refresh here sidesteps the symptom; the conflation
 * itself is unfixed and tracked in `docs/project-status.md`.
 */
test.use({ storageState: { cookies: [], origins: [] } });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Lands on `/students/new` and, if a `GET /campuses` fires, waits for it to resolve
 * before handing back control — `Promise.all` registers the response listener in the
 * same tick as the navigating click, so it cannot miss a response that fires faster than
 * we could react to afterward (the exact race `page.waitForLoadState("networkidle")` was
 * tried for first: it hung for the full 20s timeout instead, confirmed against the real
 * app — this dashboard build keeps *some* connection open continuously, so "no network
 * activity for 500ms" never becomes true).
 *
 * A *second* visit within the same test (the duplicate-rejection case re-opens this form)
 * hits `useCampuses()`'s 10-minute `staleTime` and serves from cache with no new request
 * at all — confirmed against the real app, which is why this tolerates the wait timing
 * out rather than requiring the response. Either way, by the time this returns, the
 * Campus select's data is settled and `StudentFormPage.fillRequired` needs no
 * special-cased wait or extended click timeout for its data-driven re-render.
 */
async function openNewStudentForm(page: Page): Promise<void> {
  const campusesLoaded = page
    .waitForResponse(
      (response) => response.url().includes("/campuses") && response.request().method() === "GET",
      { timeout: 3_000 },
    )
    .catch(() => null);
  await Promise.all([
    campusesLoaded,
    page.getByRole("link", { name: "New student", exact: true }).click(),
  ]);
}

/** Shared by both tests below: real sign-in, then land on the create-student form. */
async function signInAndOpenNewStudentForm(
  page: Page,
  loginPage: LoginPage,
  dashboardPage: DashboardPage,
): Promise<void> {
  await loginPage.goto();
  await loginPage.signIn({
    identifier: E2E_SCHOOL_ADMIN_EMAIL,
    password: env.LIVE_ADMIN_PASSWORD,
  });
  await expect(page).toHaveURL("/dashboard");
  // The permission-gated nav (DashboardPage's own docstring) renders after the
  // dashboard's own data loads — clicking "Students" before that finishes races an
  // empty nav, confirmed against the real app.
  await expect(dashboardPage.heading).toBeVisible();

  await dashboardPage.navLink("Students").click();
  await openNewStudentForm(page);
}

test.describe("admission -> enrollment (real API, school_admin)", () => {
  test("a school admin admits and enrolls a student in one journey", async ({
    page,
    loginPage,
    dashboardPage,
    studentFormPage,
    studentDetailPage,
    signInAsSecondIdentity,
  }) => {
    const tag = Date.now().toString(36);
    const firstName = "E2E";
    const lastName = `Journey ${tag}`;

    // 1. Create the student.
    await signInAndOpenNewStudentForm(page, loginPage, dashboardPage);
    await studentFormPage.fillRequired({
      firstName,
      lastName,
      dateOfBirth: "2015-05-05",
      admissionDate: "2026-01-01",
      campusName: E2E_BASELINE_CAMPUS_NAME,
    });
    await studentFormPage.submit.click();
    await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/);
    // Server-generated `{year}-{seq}` — confirmed against the real API, not assumed.
    await expect(page.getByText(/^\d{4}-\d{4}$/)).toBeVisible();

    // 2. Link a guardian (create new).
    await studentDetailPage.tab("Guardians").click();
    await studentDetailPage.createAndLinkGuardian({
      firstName: "Gina",
      lastName: "Guardian",
      phone: "+15551234567",
    });
    await expect(studentDetailPage.linkGuardianTrigger).toBeVisible();
    await expect(page.getByText("Gina Guardian")).toBeVisible();

    // 3. Add an emergency contact — needs `students.student.update`, only school_admin
    // holds it (see header comment).
    await studentDetailPage.tab("Emergency contacts").click();
    await studentDetailPage.addEmergencyContact({
      name: "Gina Guardian",
      relationship: "Mother",
      phone: "+15551234567",
    });
    await expect(studentDetailPage.addContactTrigger).toBeVisible();

    // 4. Enroll into the seeded baseline session/class/section.
    await studentDetailPage.tab("History").click();
    await studentDetailPage.enroll({
      sessionName: E2E_BASELINE_SESSION_NAME,
      className: E2E_BASELINE_CLASS_NAME,
      sectionName: E2E_BASELINE_SECTION_NAME,
      enrollmentDate: today(),
    });
    await expect(studentDetailPage.notEnrolledMessage).not.toBeVisible();

    // 5. Change section — same baseline section is the only one seeded, but the action
    // itself (not a real reallocation) is what this proves: the request round-trips and
    // the dialog closes on success.
    await studentDetailPage.changeSection({ sectionName: E2E_BASELINE_SECTION_NAME });

    // 6. Request an inter-campus transfer to the seeded second campus. `incoming` is
    // never offered — Phase 3's own scope decision — confirmed structurally by this
    // dialog's radio group having exactly two options (`request-transfer-dialog.tsx`),
    // not asserted again here to avoid a third, redundant locator query in the live lane.
    await studentDetailPage.requestInterCampusTransfer({
      toCampusName: E2E_SECOND_CAMPUS_NAME,
      reason: "E2E transfer journey",
      effectiveDate: today(),
    });
    await expect(page.getByText(/requested/i)).toBeVisible();

    // 7. The approver: `principal`, a different person — segregation of duties
    // (services.approve_transfer refuses a self-decision), same two-actor shape as the
    // academics promotion journey.
    const approver = await signInAsSecondIdentity({
      identifier: E2E_PRINCIPAL_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(approver.page).toHaveURL("/dashboard");
    await expect(approver.dashboardPage.heading).toBeVisible();

    await approver.studentDetailPage.goto({ path: new URL(page.url()).pathname });
    await approver.studentDetailPage.tab("History").click();
    await approver.studentDetailPage.decideTransfer("Approve");
    await expect(approver.page.getByText(/^approved$/i)).toBeVisible();

    // 8. Back in the original session: the request is now decided, and this identity
    // (not the approver) completes it — `complete` reuses `students.transfer.create`,
    // the requester's own key, confirmed against the real permission map.
    await page.reload();
    await studentDetailPage.tab("History").click();
    await expect(page.getByText(/^approved$/i)).toBeVisible();
    await studentDetailPage.completeTransfer({ sectionName: E2E_SECOND_CAMPUS_SECTION_NAME });
    await expect(page.getByText(/^completed$/i)).toBeVisible();

    // 9. The directory's own class/section/session filters, against real data: filtering
    // by the baseline session the student was enrolled in before transferring still
    // finds them (a past, no-longer-current enrollment row is still a real match — the
    // filter-correctness fix's own scope decision), proving the fix end to end against
    // the real database, not a stub.
    await dashboardPage.navLink("Students").click();
    await page.getByRole("combobox", { name: /academic session/i }).click();
    await page.getByRole("option", { name: E2E_BASELINE_SESSION_NAME }).click();
    await expect(page.getByText(lastName)).toBeVisible();
  });

  /**
   * `assert_not_duplicate` rejects an exact first/last/DOB match (module doc's own
   * "duplicate admission rate" invariant). `create_student`'s `duplicate_override_reason`
   * parameter exists in `services.py` but is never wired through `StudentSerializer` /
   * `StudentViewSet` — confirmed by reading both — so there is no override path to test
   * here; this pins the real, current (reject-only) behavior rather than an assumed one.
   */
  test("submitting the same student twice is rejected as a duplicate", async ({
    page,
    loginPage,
    dashboardPage,
    studentFormPage,
  }) => {
    const tag = Date.now().toString(36);
    const values = {
      firstName: "E2E",
      lastName: `Dup ${tag}`,
      dateOfBirth: "2015-05-05",
      admissionDate: "2026-01-01",
      campusName: E2E_BASELINE_CAMPUS_NAME,
    };

    await signInAndOpenNewStudentForm(page, loginPage, dashboardPage);
    await studentFormPage.fillRequired(values);
    await studentFormPage.submit.click();
    await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/);

    await dashboardPage.navLink("Students").click();
    await openNewStudentForm(page);
    await studentFormPage.fillRequired(values);
    await studentFormPage.submit.click();
    // `role="alert"` also matches Next.js's own route announcer — scope by text, same
    // reasoning as `login.page.ts`'s `error()` helper.
    await expect(studentFormPage.alert.filter({ hasText: /already exists/i })).toBeVisible();
  });
});
