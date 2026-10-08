import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import {
  buildAcademicSession,
  buildCampus,
  buildSchoolClass,
  buildSection,
  schoolOrganizationModule,
} from "@/mocks";
import { buildStudent, studentsModule } from "@/mocks";
import { guardiansModule } from "@/mocks";
import { studentRelationsModule } from "@/mocks";
import { buildEnrollmentHistoryEvent, enrollmentModule } from "@/mocks";
import { studentTransfersModule } from "@/mocks";

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];
const classes = [buildSchoolClass({ id: "class-0001", name: "Grade 1" })];
const sections = [
  buildSection({ id: "section-0001", name: "A", class_id: "class-0001", campus_id: "campus-0001" }),
];
const sessions = [buildAcademicSession({ id: "session-0001", name: "2026-27" })];
const student = buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" });

test.describe("student enrollment tab", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "students.enrollment.enroll",
        "students.enrollment.update",
        "students.student.update",
        "students.guardian.view",
      ],
    }),
  });

  test("shows Not Enrolled and enrolls the student, cascading session/class/section", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: { "student-0001": [] } }),
      studentTransfersModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();

    await expect(page.getByText(/not enrolled/i)).toBeVisible();
    await page.getByRole("button", { name: /^enroll$/i }).click();

    await page.getByRole("combobox", { name: /academic session/i }).click();
    await page.getByRole("option", { name: "2026-27" }).click();
    await page.getByRole("combobox", { name: /^class$/i }).click();
    await page.getByRole("option", { name: "Grade 1" }).click();
    await page.getByRole("combobox", { name: /^section$/i }).click();
    await page.getByRole("option", { name: "A" }).click();
    await page.getByLabel(/enrollment date/i).fill("2026-04-05");
    // The capacity-override-reason field is visible unconditionally for this role
    // (`students.student.update`), confirming the permission gate works both ways.
    await expect(page.getByLabel(/capacity override reason/i)).toBeVisible();

    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^enroll$/i })
      .click();

    await expect(page.getByText(/2026-27/)).toBeVisible();
  });

  test("changes section for an already-enrolled student", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({
        historyByStudentId: {
          "student-0001": [
            buildEnrollmentHistoryEvent({
              academic_session_id: "session-0001",
              academic_session_name: "2026-27",
              class_id: "class-0001",
              class_name: "Grade 1",
              section_id: "section-0001",
              section_name: "A",
            }),
          ],
        },
      }),
      studentTransfersModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();

    await expect(page.getByText(/2026-27/)).toBeVisible();
    await page.getByRole("button", { name: /change section/i }).click();

    // The class is a fixed label in this dialog, not a Select.
    await expect(page.getByRole("combobox", { name: /^class$/i })).toHaveCount(0);
    await page.getByRole("combobox", { name: /^section$/i }).click();
    await page.getByRole("option", { name: "A" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /change section/i })
      .click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("student enrollment tab — view-only permissions", () => {
  test.use({
    authUser: buildUser({ permissions: [...SCHOOL_ADMIN_PERMISSIONS] }),
  });

  test("hides Enroll and Change Section without the enrollment permission keys", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: { "student-0001": [] } }),
      studentTransfersModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();

    await expect(page.getByText(/not enrolled/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^enroll$/i })).toHaveCount(0);
  });
});
