import { expect, test } from "@/fixtures";
import {
  buildUser,
  EXAMS_AUTHOR_PERMISSIONS,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildAcademicSession,
  buildCampus,
  buildExam,
  buildExamSubject,
  buildGradingScale,
  buildRoom,
  buildSchoolClass,
  buildSection,
  buildSitting,
  type ExamCandidate,
  examsScheduleModule,
  examsSetupModule,
  type MockApi,
  schoolOrganizationModule,
  staffModule,
  timetableSetupModule,
} from "@/mocks";

/**
 * An exam's Schedule and Admit cards tabs (PR B) against a stubbed API, as one exam-staff
 * journey: two sittings clash over a room, the clash blocks publishing, moving one clears it, the
 * schedule publishes, cards are issued (the server's counts shown), one is revoked with a reason,
 * and a second issue run reports the top-up without reinstating it. The stub mirrors the server's
 * rules the screens surface (L5); whether the server enforces them is the live lane's
 * (`tests/live/api/exams-schedule.spec.ts`).
 */

const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const campus = buildCampus({ id: ORG_IDS.mainCampus });
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const sectionA = buildSection({
  id: ORG_IDS.sectionA,
  name: "A",
  class_id: grade1.id,
  campus_id: campus.id,
});
const sectionB = buildSection({
  id: ORG_IDS.sectionB,
  name: "B",
  class_id: grade1.id,
  campus_id: campus.id,
});
const hall = buildRoom({
  id: uuid(),
  campus_id: campus.id,
  campus_name: campus.name,
  name: "Hall 1",
  code: "H-1",
});

const candidates: ExamCandidate[] = [
  {
    studentId: uuid(),
    studentName: "Ali Raza",
    admissionNumber: "ADM-001",
    sectionId: sectionA.id,
    sectionName: "A",
  },
  {
    studentId: uuid(),
    studentName: "Sara Khan",
    admissionNumber: "ADM-002",
    sectionId: sectionA.id,
    sectionName: "A",
  },
  {
    studentId: uuid(),
    studentName: "Omar Malik",
    admissionNumber: "ADM-003",
    sectionId: sectionB.id,
    sectionName: "B",
  },
];

const examStaff = buildUser({
  permissions: [
    ...SCHOOL_ADMIN_PERMISSIONS,
    ...EXAMS_AUTHOR_PERMISSIONS,
    "exams.schedule.view",
    "exams.schedule.create",
    "exams.schedule.update",
    "exams.admit-card.view",
    "exams.admit-card.issue",
  ],
});

const SITTING_PATH = /\/exam-schedules\/[^/]+$/;
const PUBLISH_PATH = /\/exams\/[^/]+:publish-schedule$/;
const ISSUE_PATH = /\/exams\/[^/]+:issue-admit-cards$/;
const REVOKE_PATH = /\/admit-cards\/[^/]+:revoke$/;

/** A draft exam with Mathematics for Grade 1, sat by A and B in Hall 1 at the same time. */
function stubScheduleApi(mockApi: MockApi) {
  const exam = buildExam({
    name: "Midterm 2026",
    academic_session_id: session.id,
    academic_session_name: session.name,
  });
  const maths = buildExamSubject({
    exam_id: exam.id,
    class_id: grade1.id,
    class_name: grade1.name,
    subject_name: "Mathematics",
  });
  const sitting = (section: typeof sectionA) =>
    buildSitting({
      exam_id: exam.id,
      exam_subject_id: maths.id,
      section_id: section.id,
      section_name: section.name,
      room_id: hall.id,
      room_name: hall.name,
    });
  const exams = [exam];

  mockApi.use(
    schoolOrganizationModule({
      campuses: [campus],
      academicSessions: [session],
      classes: [grade1],
      sections: [sectionA, sectionB],
    }),
    timetableSetupModule({ rooms: [hall], campuses: [campus] }),
    staffModule({ staff: [] }),
    examsSetupModule({
      exams,
      examSubjects: [maths],
      gradingScales: [buildGradingScale({ is_default: true })],
      sessions: [session],
      classes: [grade1],
    }),
    examsScheduleModule({
      exams,
      sittings: [sitting(sectionA), sitting(sectionB)],
      candidates,
      rooms: [hall],
    }),
  );
  return exam;
}

test.describe("an exam's schedule and admit cards", () => {
  test.use({ authUser: examStaff });

  test("resolves a room clash, publishes, issues cards and revokes one", async ({
    page,
    mockApi,
    examSchedulePage,
    examAdmitCardsPage,
    signedIn: _signedIn,
  }) => {
    const exam = stubScheduleApi(mockApi);
    await examSchedulePage.gotoSchedule(exam.id);

    // Both sittings book Hall 1 at 09:00: a hard clash, which holds Publish.
    await expect(examSchedulePage.conflictList).toContainText(
      "Room Hall 1 is booked twice on 2026-10-05: 09:00-11:00 and 09:00-11:00.",
    );
    await expect(examSchedulePage.blockedNote).toHaveText("1 blocking clash to resolve first");
    await expect(examSchedulePage.publishButton).toBeDisabled();

    // Move section B's sitting to the afternoon.
    await examSchedulePage.rescheduleButton("Mathematics", "Grade 1", "B").click();
    await examSchedulePage.sittingField("Starts").fill("13:00");
    await examSchedulePage.sittingField("Ends").fill("15:00");
    const reschedule = page.waitForRequest((r) => isApiCall(r, "PATCH", SITTING_PATH));
    await examSchedulePage.saveSittingButton.click();
    expect((await reschedule).postDataJSON()).toMatchObject({
      section_id: sectionB.id,
      start_time: "13:00",
      end_time: "15:00",
      room_id: hall.id,
    });
    await expect(examSchedulePage.sittingDialog).toBeHidden();

    await expect(examSchedulePage.noConflicts).toBeVisible();
    await expect(examSchedulePage.blockedNote).toHaveCount(0);

    const publish = page.waitForRequest((r) => isApiCall(r, "POST", PUBLISH_PATH));
    await examSchedulePage.publishButton.click();
    await examSchedulePage.confirmPublish.click();
    await publish;
    await expect(examSchedulePage.publishDialog).toBeHidden();

    // Published (the exam reloads as scheduled), so the cards can be issued: the counts beside
    // the button are the server's.
    await examAdmitCardsPage.tab("Admit cards").click();
    const issue = page.waitForRequest((r) => isApiCall(r, "POST", ISSUE_PATH));
    await examAdmitCardsPage.issueButton.click();
    expect((await issue).headers()["idempotency-key"]).toBeTruthy();
    await expect(examAdmitCardsPage.issueStatus).toContainText(
      "3 admit cards added; none already existed.",
    );
    for (const student of candidates) {
      await expect(examAdmitCardsPage.row(student.studentName)).toContainText("Issued");
    }
    await expect(examAdmitCardsPage.downloadButton("Sara Khan")).toBeVisible();

    // A revoke needs a reason; once given, the card shows it and offers no download.
    await examAdmitCardsPage.revokeButton("Sara Khan").click();
    await examAdmitCardsPage.confirmRevoke.click();
    await expect(examAdmitCardsPage.revokeDialog).toContainText(
      "Give a reason for revoking this card.",
    );
    await examAdmitCardsPage.revokeReason.fill("Fees outstanding");
    const revoke = page.waitForRequest((r) => isApiCall(r, "POST", REVOKE_PATH));
    await examAdmitCardsPage.confirmRevoke.click();
    expect((await revoke).postDataJSON()).toEqual({ reason: "Fees outstanding" });
    await expect(examAdmitCardsPage.revokeDialog).toBeHidden();
    const revoked = examAdmitCardsPage.row("Sara Khan");
    await expect(revoked).toContainText("Revoked");
    await expect(revoked).toContainText("Reason: Fees outstanding");
    await expect(examAdmitCardsPage.downloadButton("Sara Khan")).toHaveCount(0);
    await expect(examAdmitCardsPage.revokeButton("Sara Khan")).toHaveCount(0);

    // A second run tops up nothing, and the revoked card stays revoked.
    await expect(examAdmitCardsPage.issueButton).toBeEnabled();
    await examAdmitCardsPage.issueButton.click();
    await expect(examAdmitCardsPage.issueStatus).toContainText(
      "No new admit cards; 3 already existed.",
    );
    await expect(revoked).toContainText("Revoked");
    await expect(examAdmitCardsPage.downloadButton("Sara Khan")).toHaveCount(0);
  });

  test("offers no Issue admit cards before the schedule is published", async ({
    mockApi,
    examAdmitCardsPage,
    signedIn: _signedIn,
  }) => {
    const exam = stubScheduleApi(mockApi);
    await examAdmitCardsPage.gotoAdmitCards(exam.id);

    await expect(examAdmitCardsPage.tab("Admit cards")).toHaveAttribute("aria-selected", "true");
    await expect(examAdmitCardsPage.draftNotice).toBeVisible();
    await expect(examAdmitCardsPage.issueButton).toHaveCount(0);
  });
});
