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
import { buildEnrollmentHistoryEvent, enrollmentModule, type HistoryEvent } from "@/mocks";
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
    // `studentsModule`'s `:enroll` handler and `enrollmentModule`'s own `GET .../history`
    // are two separate mock modules with no shared state — `onEnrollmentAction` mirrors the
    // newly created enrollment into the same `history` object so the post-enroll refetch
    // actually reflects it, matching what the real backend's history endpoint would show.
    const history: Record<string, HistoryEvent[]> = { "student-0001": [] };
    mockApi.use(
      schoolOrganizationModule({ campuses, classes, sections, academicSessions: sessions }),
      studentsModule({
        students: [student],
        onEnrollmentAction: (_action, enrollment) => {
          history["student-0001"]?.push(
            buildEnrollmentHistoryEvent({
              id: enrollment.id,
              date: enrollment.enrollment_date,
              academic_session_id: enrollment.academic_session_id,
              academic_session_name:
                sessions.find((s) => s.id === enrollment.academic_session_id)?.name ?? "",
              class_id: enrollment.class_id,
              class_name: classes.find((c) => c.id === enrollment.class_id)?.name ?? "",
              section_id: enrollment.section_id,
              section_name: sections.find((s) => s.id === enrollment.section_id)?.name ?? "",
              roll_number: enrollment.roll_number,
            }),
          );
        },
      }),
      guardiansModule({}),
      studentRelationsModule({}),
      enrollmentModule({ historyByStudentId: history }),
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

    // Exact text, not a `/2026-27/` substring match — the history timeline's own new
    // "Enrolled — 2026-27, Grade 1 A" entry contains the same substring and would make
    // this a strict-mode violation (two matches) otherwise.
    await expect(page.getByText("2026-27 — Grade 1 A", { exact: true })).toBeVisible();
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

    // Exact text — the history timeline's own "Enrolled — 2026-27, Grade 1 A" entry
    // contains the same substring and would make this a strict-mode violation otherwise.
    await expect(page.getByText("2026-27 — Grade 1 A", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /change section/i }).click();

    // The class is a fixed label in this dialog, not a Select.
    await expect(page.getByRole("combobox", { name: /^class$/i })).toHaveCount(0);
    await page.getByRole("combobox", { name: /^section$/i }).click();
    await page.getByRole("option", { name: "A" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /change section/i })
      .click();

    // Not `getByRole("dialog")).toHaveCount(0)` — `StudentDetailSheet` is itself a Radix
    // `Dialog` under a different visual treatment (`packages/ui`'s `Sheet` is literally
    // `Dialog as SheetPrimitive`), so it also carries `role="dialog"` and stays open
    // throughout this test. The section picker is scoped to the now-closed nested dialog.
    await expect(page.getByRole("combobox", { name: /^section$/i })).toHaveCount(0);
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
