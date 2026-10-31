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
import type { DashboardPage, LoginPage, StudentsPage } from "@/pages";

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
 * contact before `:enroll` succeeds). The journey below makes exactly those calls
 * through the shipped UI: the creation wizard (`StudentCreateStepper`, opened by the
 * directory's "New student" button), whose Profile step creates the student and whose
 * later steps render the same relation panels as the detail sheet. Neither the wizard
 * nor the sheet has a URL, so a later visit to the student goes through its directory
 * row.
 *
 * Every navigation after the one real sign-in is client-side (`nav` link clicks, not
 * `page.goto`) deliberately: a full page load re-boots the app with an empty in-memory
 * access token, forcing an eager refresh off the rotating `sh_refresh` cookie (one
 * request of `AuthEndpointThrottle`'s budget, e2e/AGENTS.md). The one exception is
 * step 8's reload, which that step explains. A refresh that fails for any reason —
 * a rate limit or a transient 5xx included, not just an expired token — is treated as
 * "session over" by `packages/api-client`'s `refreshAccessToken()`/`refreshOnce()` and
 * bounces to `/login`; that conflation is unfixed and tracked in
 * `docs/project-status.md`.
 */
test.use({ storageState: { cookies: [], origins: [] } });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Shared by both tests below: real sign-in, then land on the students directory. */
async function signInToStudents(
  page: Page,
  loginPage: LoginPage,
  dashboardPage: DashboardPage,
  studentsPage: StudentsPage,
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
  await expect(studentsPage.addStudentButton).toBeVisible();
}

test.describe("admission -> enrollment (real API, school_admin)", () => {
  test("a school admin admits and enrolls a student in one journey", async ({
    page,
    loginPage,
    dashboardPage,
    studentsPage,
    studentCreateStepperPage: stepper,
    studentDetailPage,
    signInAsSecondIdentity,
  }) => {
    const tag = Date.now().toString(36);
    const firstName = "E2E";
    const lastName = `Journey ${tag}`;

    // 1. Create the student: Profile's Next submits it and moves to Guardians.
    await signInToStudents(page, loginPage, dashboardPage, studentsPage);
    await studentsPage.addStudentButton.click();
    await stepper.fillProfile({
      firstName,
      lastName,
      dateOfBirth: "2015-05-05",
      admissionDate: "2026-01-01",
      campusName: E2E_BASELINE_CAMPUS_NAME,
    });
    await stepper.next.click();
    await expect(stepper.createdBanner(`${firstName} ${lastName}`)).toBeVisible();

    // 2. Guardians: create a guardian and link it.
    await stepper.relations.createAndLinkGuardian({
      firstName: "Gina",
      lastName: "Guardian",
      phone: "+15551234567",
      relationship: "Mother",
    });
    await expect(stepper.relations.entry("Gina Guardian")).toBeVisible();

    // 3. Emergency contacts — needs `students.student.update`, only school_admin
    // holds it (see header comment).
    await stepper.next.click();
    await stepper.relations.addEmergencyContact({
      name: "Gina Guardian",
      relationship: "Mother",
      phone: "+15551234567",
    });
    await expect(stepper.relations.entry("Gina Guardian")).toBeVisible();

    // 4. Documents is optional and skipped; then enroll into the seeded baseline
    // session/class/section on the History step.
    await stepper.next.click();
    await stepper.next.click();
    await stepper.relations.enroll({
      sessionName: E2E_BASELINE_SESSION_NAME,
      className: E2E_BASELINE_CLASS_NAME,
      sectionName: E2E_BASELINE_SECTION_NAME,
      enrollmentDate: today(),
    });
    await expect(stepper.relations.notEnrolledMessage).not.toBeVisible();

    // 5. Change section — same baseline section is the only one seeded, but the action
    // itself (not a real reallocation) is what this proves: the request round-trips and
    // the dialog closes on success.
    await stepper.relations.changeSection({ sectionName: E2E_BASELINE_SECTION_NAME });

    // 6. Request an inter-campus transfer to the seeded second campus. `incoming` is
    // never offered — Phase 3's own scope decision — confirmed structurally by this
    // dialog's radio group having exactly two options (`request-transfer-dialog.tsx`),
    // not asserted again here to avoid a third, redundant locator query in the live lane.
    await stepper.relations.requestInterCampusTransfer({
      toCampusName: E2E_SECOND_CAMPUS_NAME,
      reason: "E2E transfer journey",
      effectiveDate: today(),
    });
    await expect(stepper.relations.transferStatus("Requested")).toBeVisible();

    // History is the last step, so its forward button reads "Finish" and closes the
    // wizard. The directory row shows the server-generated `{year}-{seq:04d}` admission
    // number, the year taken from the admission date — confirmed against
    // `services.py`'s default pattern, not assumed.
    await stepper.finish.click();
    await expect(stepper.dialog).toBeHidden();
    await studentsPage.searchInput.fill(lastName);
    await expect(studentsPage.row(lastName).getByText(/^2026-\d{4,}$/)).toBeVisible();

    // 7. The approver: `principal`, a different person — segregation of duties
    // (services.approve_transfer refuses a self-decision), same two-actor shape as the
    // academics promotion journey. Reaches the student through its own directory.
    const approver = await signInAsSecondIdentity({
      identifier: E2E_PRINCIPAL_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(approver.page).toHaveURL("/dashboard");
    await expect(approver.dashboardPage.heading).toBeVisible();

    await approver.dashboardPage.navLink("Students").click();
    await approver.studentsPage.openStudent(lastName);
    await approver.studentDetailPage.openTab("History");
    await approver.studentDetailPage.relations.decideTransfer("Approve");
    await expect(approver.studentDetailPage.relations.transferStatus("Approved")).toBeVisible();

    // 8. Back in the original session: the request is now decided, and this identity
    // (not the approver) completes it — `complete` reuses `students.transfer.create`,
    // the requester's own key, confirmed against the real permission map.
    //
    // A reload, not just re-opening the row: the wizard's History step already cached
    // this student's transfers, and that cache is fresh for 30s
    // (`DEFAULT_QUERY_STALE_TIME_MS`), so a sheet opened sooner would show the stale
    // "Requested" with no Complete button. The approval happens in another browser, so
    // nothing in this one invalidates it; the reload costs one refresh.
    await page.reload();
    await studentsPage.openStudent(lastName);
    await studentDetailPage.openTab("History");
    await expect(studentDetailPage.relations.transferStatus("Approved")).toBeVisible();
    await studentDetailPage.relations.completeTransfer({
      sectionName: E2E_SECOND_CAMPUS_SECTION_NAME,
    });
    await expect(studentDetailPage.relations.transferStatus("Completed")).toBeVisible();

    // 9. The directory's own class/section/session filters, against real data: filtering
    // by the baseline session the student was enrolled in before transferring still
    // finds them (a past, no-longer-current enrollment row is still a real match — the
    // filter-correctness fix's own scope decision), proving the fix end to end against
    // the real database, not a stub. The search from step 8 stays applied. The proof is
    // the filtered response's own body: the table keeps the previous rows on screen while
    // a filtered page loads (`keepPreviousData`), so the row alone would match the stale
    // list before the filtered one renders.
    await studentDetailPage.close();
    const filteredList = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/students") &&
        url.searchParams.has("academic_session_id") &&
        response.request().method() === "GET"
      );
    });
    await studentsPage.sessionFilter.click();
    await page.getByRole("option", { name: E2E_BASELINE_SESSION_NAME, exact: true }).click();
    const filtered = await filteredList;
    expect(filtered.ok()).toBe(true);
    const { data } = (await filtered.json()) as { data: { last_name: string }[] };
    expect(data.map((student) => student.last_name)).toContain(lastName);
    await expect(studentsPage.row(lastName)).toBeVisible();
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
    studentsPage,
    studentCreateStepperPage: stepper,
  }) => {
    const tag = Date.now().toString(36);
    const values = {
      firstName: "E2E",
      lastName: `Dup ${tag}`,
      dateOfBirth: "2015-05-05",
      admissionDate: "2026-01-01",
      campusName: E2E_BASELINE_CAMPUS_NAME,
    };

    // Profile's Finish creates the student and closes the wizard.
    await signInToStudents(page, loginPage, dashboardPage, studentsPage);
    await studentsPage.addStudentButton.click();
    await stepper.fillProfile(values);
    await stepper.finish.click();
    await expect(stepper.dialog).toBeHidden();
    await studentsPage.searchInput.fill(values.lastName);
    await expect(studentsPage.row(values.lastName)).toBeVisible();

    // A fresh wizard, the same Profile: the server's non-field 422 stays in the dialog.
    await studentsPage.addStudentButton.click();
    await stepper.fillProfile(values);
    await stepper.next.click();
    // `role="alert"` also matches Next.js's own route announcer — scope by text, same
    // reasoning as `login.page.ts`'s `error()` helper.
    await expect(stepper.formError.filter({ hasText: /already exists/i })).toBeVisible();
  });
});
