import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the Examinations screens' tests share: a test file's `jest.mock("@/services", ...)`
 * factory reaches it through `jest.requireActual`. */
export function examsServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    exams: ["fetchExamsPage", "fetchExam", "createExam", "updateExam", "deleteExam"],
    examSubjects: [
      "fetchExamSubjects",
      "createExamSubject",
      "updateExamSubject",
      "deleteExamSubject",
    ],
    examSchedules: [
      "fetchSittings",
      "createSitting",
      "updateSitting",
      "cancelSitting",
      "deleteSitting",
      "fetchConflicts",
      "publishSchedule",
    ],
    admitCards: [
      "fetchAdmitCardsPage",
      "issueAdmitCards",
      "revokeAdmitCard",
      "fetchAdmitCardDownloadUrl",
    ],
    jobs: ["fetchJob"],
    schoolOrganization: ["fetchAcademicSessions", "fetchTerms", "fetchClasses", "fetchSections"],
    rooms: ["fetchActiveRooms"],
    staff: ["fetchTeachingStaffOptions"],
    gradingScales: ["fetchScalesPage"],
    curriculum: ["fetchCurriculumForClass"],
  });
}
