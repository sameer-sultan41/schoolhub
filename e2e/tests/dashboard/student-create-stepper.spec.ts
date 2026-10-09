import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import {
  buildAcademicSession,
  buildCampus,
  buildGuardian,
  buildSchoolClass,
  buildSection,
  schoolOrganizationModule,
} from "@/mocks";
import { studentsModule } from "@/mocks";
import { guardiansModule } from "@/mocks";
import { studentRelationsModule } from "@/mocks";
import { enrollmentModule } from "@/mocks";
import { studentTransfersModule } from "@/mocks";

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];
const classes = [buildSchoolClass({ id: "class-0001", name: "Grade 1" })];
const sections = [
  buildSection({ id: "section-0001", name: "A", class_id: "class-0001", campus_id: "campus-0001" }),
];
const sessions = [buildAcademicSession({ id: "session-0001", name: "2026-27" })];

test.describe("student creation stepper", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        // `SCHOOL_ADMIN_PERMISSIONS` (e2e/src/data/factories.ts) holds only
        // `students.student.view` — every step this test walks through (New
        // student, Guardians, Emergency Contacts, Documents) is gated on its own
        // create/update key (`student-create-stepper.tsx`'s own
        // `canViewGuardians`/`canViewEmergencyContacts`/`canViewDocuments`), so each
        // is granted explicitly here rather than assumed from the admin preset.
        "students.student.create",
        "students.guardian.create",
        "students.student.update",
        "students.document.create",
        "students.enrollment.enroll",
        "students.enrollment.update",
      ],
    }),
  });

  test("creates a student, adds a guardian, and finishes without enrolling", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const guardian = buildGuardian({ id: "guardian-0001", first_name: "Imran", last_name: "Raza" });
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [] }),
      guardiansModule({ guardians: [guardian] }),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: {} }),
      studentTransfersModule({}),
    );
    await studentsPage.goto();
    await studentsPage.addStudentButton.click();

    await page.getByLabel(/first name/i).fill("Ayesha");
    await page.getByLabel(/last name/i).fill("Khan");
    await page.getByLabel(/date of birth/i).fill("2012-05-01");
    await page.getByLabel(/admission date/i).fill("2026-01-10");
    await page.getByRole("combobox", { name: /gender/i }).click();
    await page.getByRole("option", { name: /female/i }).click();
    await page.getByRole("combobox", { name: /^campus$/i }).click();
    await page.getByRole("option", { name: "Main Campus" }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    await expect(page.getByText(/ayesha khan.*has been created/i)).toBeVisible();

    // Mirrors students-relations.spec.ts's own "links an existing guardian found by
    // search" flow — same search-then-link dialog, now opened from inside the wizard.
    await page.getByRole("button", { name: /link guardian/i }).click();
    await page.getByLabel(/search by name or phone/i).fill("Imran");
    await page.getByRole("combobox", { name: /search existing/i }).click();
    await page.getByRole("option", { name: /imran raza/i }).click();
    await page.getByRole("combobox", { name: /relationship/i }).click();
    await page.getByRole("option", { name: /^father$/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^link guardian$/i })
      .click();
    await expect(page.getByText("Imran Raza")).toBeVisible();

    await page.getByRole("button", { name: /^next$/i }).click(); // Emergency Contacts
    await page.getByRole("button", { name: /^next$/i }).click(); // Documents
    await page.getByRole("button", { name: /^finish$/i }).click(); // Enrollment, unfilled

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Ayesha Khan")).toBeVisible();
  });
});

test.describe("student creation stepper — view-only permissions", () => {
  test.use({
    authUser: buildUser({ permissions: ["students.student.create", "students.student.view"] }),
  });

  test("shows Profile then Finish only, for a viewer with no other step permissions", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [] }),
    );
    await studentsPage.goto();
    await studentsPage.addStudentButton.click();

    await page.getByLabel(/first name/i).fill("Bilal");
    await page.getByLabel(/last name/i).fill("Ahmed");
    await page.getByLabel(/date of birth/i).fill("2013-02-02");
    await page.getByLabel(/admission date/i).fill("2026-01-10");
    await page.getByRole("combobox", { name: /gender/i }).click();
    // Anchored — an unanchored `/male/i` also matches "Female".
    await page.getByRole("option", { name: /^male$/i }).click();
    await page.getByRole("combobox", { name: /^campus$/i }).click();
    await page.getByRole("option", { name: "Main Campus" }).click();
    // This permission set has no step past Profile, so its own submit button already
    // reads "Finish" (not "Next") — there's no later step to advance into, and
    // `onSaved` closes the wizard directly once this single submit succeeds (Review
    // Focus #2: closing right after Profile, no later step ever touched, still
    // leaves the student created and visible in the directory).
    await page.getByRole("button", { name: /^finish$/i }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Bilal Ahmed")).toBeVisible();
  });
});
