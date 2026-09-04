import { env } from "@/env";
import { expect, test } from "@/fixtures";
import {
  E2E_BASELINE_CAMPUS_NAME,
  E2E_BASELINE_CLASS_NAME,
  E2E_BASELINE_SECTION_NAME,
  E2E_BASELINE_SESSION_NAME,
  E2E_SCHOOL_ADMIN_EMAIL,
} from "@/lib/seed-constants";

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
 * access token, forcing an eager refresh off the rotating `sh_refresh` cookie — fine
 * once, but this journey visits `/students/new` twice (create, then re-create for the
 * duplicate case) and a second cold refresh this soon after the first raced the token
 * rotation on a loaded machine and the app treated it as a logout (confirmed against the
 * real app, not assumed — this exact journey redirected to `/login` mid-run at the
 * `page.goto("/students/new")` version of this spec).
 */
test.use({ storageState: { cookies: [], origins: [] } });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe("admission -> enrollment (real API, school_admin)", () => {
  test("a school admin admits and enrolls a student in one journey", async ({
    page,
    loginPage,
    dashboardPage,
    studentFormPage,
    studentDetailPage,
  }) => {
    const tag = Date.now().toString(36);
    const firstName = "E2E";
    const lastName = `Journey ${tag}`;

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

    // 1. Create the student.
    await dashboardPage.navLink("Students").click();
    await page.getByRole("link", { name: "New student", exact: true }).click();
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
    await studentDetailPage.enroll({
      sessionName: E2E_BASELINE_SESSION_NAME,
      className: E2E_BASELINE_CLASS_NAME,
      sectionName: E2E_BASELINE_SECTION_NAME,
      enrollmentDate: today(),
    });
    await expect(studentDetailPage.notEnrolledMessage).not.toBeVisible();
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
    const newStudentLink = page.getByRole("link", { name: "New student", exact: true });

    await loginPage.goto();
    await loginPage.signIn({
      identifier: E2E_SCHOOL_ADMIN_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(dashboardPage.heading).toBeVisible();

    await dashboardPage.navLink("Students").click();
    await newStudentLink.click();
    await studentFormPage.fillRequired(values);
    await studentFormPage.submit.click();
    await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/);

    await dashboardPage.navLink("Students").click();
    await newStudentLink.click();
    await studentFormPage.fillRequired(values);
    await studentFormPage.submit.click();
    // `role="alert"` also matches Next.js's own route announcer — scope by text, same
    // reasoning as `login.page.ts`'s `error()` helper.
    await expect(studentFormPage.alert.filter({ hasText: /already exists/i })).toBeVisible();
  });
});
