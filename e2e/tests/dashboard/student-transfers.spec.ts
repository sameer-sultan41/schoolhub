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
import { buildStudentTransfer, studentTransfersModule } from "@/mocks";

const campuses = [
  buildCampus({ id: "campus-0001", name: "Main Campus" }),
  buildCampus({ id: "campus-0002", name: "North Campus" }),
];
const classes = [buildSchoolClass({ id: "class-0001", name: "Grade 1" })];
const sections = [
  buildSection({ id: "section-0001", name: "A", class_id: "class-0001", campus_id: "campus-0001" }),
  buildSection({ id: "section-0002", name: "B", class_id: "class-0001", campus_id: "campus-0002" }),
];
const sessions = [buildAcademicSession({ id: "session-0001", name: "2026-27" })];
const student = buildStudent({
  id: "student-0001",
  first_name: "Ayesha",
  last_name: "Khan",
  campus_id: "campus-0001",
});
const currentEnrollment = buildEnrollmentHistoryEvent({
  academic_session_id: "session-0001",
  academic_session_name: "2026-27",
  class_id: "class-0001",
  class_name: "Grade 1",
  section_id: "section-0001",
  section_name: "A",
});

test.describe("student transfers tab", () => {
  test.use({
    authUser: buildUser({
      permissions: [...SCHOOL_ADMIN_PERMISSIONS, "students.transfer.create"],
    }),
  });

  test("requests an inter-campus transfer, offering only inter_campus and outgoing", async ({
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
      enrollmentModule({ historyByStudentId: { "student-0001": [currentEnrollment] } }),
      studentTransfersModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();
    await page.getByRole("button", { name: /request transfer/i }).click();

    const options = page.getByRole("radio");
    await expect(options).toHaveCount(2);
    await expect(page.getByText(/incoming/i)).toHaveCount(0);

    await page.getByRole("combobox", { name: /to campus/i }).click();
    await page.getByRole("option", { name: "North Campus" }).click();
    await page.getByLabel(/^reason$/i).fill("Family relocation");
    await page.getByLabel(/effective date/i).fill("2026-05-01");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /request transfer/i })
      .click();

    await expect(page.getByText(/requested/i)).toBeVisible();
  });
});

test.describe("student transfers tab — decisions", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "students.transfer.approve",
        "students.transfer.create",
      ],
    }),
  });

  test("approves a requested transfer", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const transfer = buildStudentTransfer({
      id: "transfer-0001",
      student_id: "student-0001",
      status: "requested",
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: { "student-0001": [currentEnrollment] } }),
      studentTransfersModule({ transfers: [transfer] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();

    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();

    await expect(page.getByText(/^approved$/i)).toBeVisible();
  });

  test("rejects a requested transfer", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const transfer = buildStudentTransfer({
      id: "transfer-0001",
      student_id: "student-0001",
      status: "requested",
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: { "student-0001": [currentEnrollment] } }),
      studentTransfersModule({ transfers: [transfer] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();

    await page.getByRole("button", { name: "Reject" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reject" }).click();

    await expect(page.getByText(/^rejected$/i)).toBeVisible();
  });

  test("completes an approved transfer, picking a destination section", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const transfer = buildStudentTransfer({
      id: "transfer-0001",
      student_id: "student-0001",
      status: "approved",
      to_campus_id: "campus-0002",
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: { "student-0001": [currentEnrollment] } }),
      studentTransfersModule({ transfers: [transfer] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();

    await page.getByRole("button", { name: /^complete$/i }).click();
    await page.getByRole("combobox", { name: /^section$/i }).click();
    await page.getByRole("option", { name: "B" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^complete$/i })
      .click();

    await expect(page.getByText(/^completed$/i)).toBeVisible();
  });
});

test.describe("student transfers tab — view-only permissions", () => {
  test.use({
    authUser: buildUser({ permissions: [...SCHOOL_ADMIN_PERMISSIONS] }),
  });

  test("hides Approve and Reject without students.transfer.approve", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const transfer = buildStudentTransfer({
      id: "transfer-0001",
      student_id: "student-0001",
      status: "requested",
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: { "student-0001": [currentEnrollment] } }),
      studentTransfersModule({ transfers: [transfer] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^history$/i }).click();

    await expect(page.getByText(/requested/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });
});
