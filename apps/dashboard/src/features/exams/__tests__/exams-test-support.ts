import type { PermissionKey } from "@schoolhub/types";

import { Services } from "@/services";
import { admitCardPage } from "@/services/modules/admit-cards/__tests__/admit-cards-fixtures";
import { resultPage } from "@/services/modules/exam-results/__tests__/exam-results-fixtures";
import { reportCardPage } from "@/services/modules/report-cards/__tests__/report-cards-fixtures";
import { curriculumRecord } from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import {
  examPage,
  examRecord,
  SCALE_ID,
  TERM_ID,
} from "@/services/modules/exams/__tests__/exams-fixtures";
import { subjectRecord } from "@/services/modules/exam-subjects/__tests__/exam-subjects-fixtures";
import { CLASS_ID, CURRENT_SESSION, PLANNED_SESSION } from "@/test-fixtures/academics";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, setUrl } from "@/test-utils";

/** Shared setup for the Examinations tests; each file keeps its own `jest.mock` calls (hoisting). */

export { lastArg, mocked, pick, rowOf, urlParam } from "@/test-fixtures/list-screen";

export const fetchExamsPage = mocked(Services.exams.fetchExamsPage);
export const fetchExam = mocked(Services.exams.fetchExam);
export const createExam = mocked(Services.exams.createExam);
export const updateExam = mocked(Services.exams.updateExam);
export const deleteExam = mocked(Services.exams.deleteExam);
export const fetchExamSubjects = mocked(Services.examSubjects.fetchExamSubjects);
export const createExamSubject = mocked(Services.examSubjects.createExamSubject);
export const updateExamSubject = mocked(Services.examSubjects.updateExamSubject);
export const deleteExamSubject = mocked(Services.examSubjects.deleteExamSubject);
export const fetchSittings = mocked(Services.examSchedules.fetchSittings);
export const fetchConflicts = mocked(Services.examSchedules.fetchConflicts);
export const createSitting = mocked(Services.examSchedules.createSitting);
export const updateSitting = mocked(Services.examSchedules.updateSitting);
export const cancelSitting = mocked(Services.examSchedules.cancelSitting);
export const deleteSitting = mocked(Services.examSchedules.deleteSitting);
export const publishSchedule = mocked(Services.examSchedules.publishSchedule);
export const fetchAdmitCardsPage = mocked(Services.admitCards.fetchAdmitCardsPage);
export const issueAdmitCards = mocked(Services.admitCards.issueAdmitCards);
export const revokeAdmitCard = mocked(Services.admitCards.revokeAdmitCard);
export const fetchAdmitCardDownloadUrl = mocked(Services.admitCards.fetchAdmitCardDownloadUrl);
export const fetchJob = mocked(Services.jobs.fetchJob);
export const fetchGrid = mocked(Services.marks.fetchGrid);
export const bulkEntry = mocked(Services.marks.bulkEntry);
export const fetchProgress = mocked(Services.marks.fetchProgress);
export const lockMarks = mocked(Services.marks.lockMarks);
export const unlockMarks = mocked(Services.marks.unlockMarks);
export const importMarks = mocked(Services.marks.importMarks);
export const fetchStudentMarks = mocked(Services.marks.fetchStudentMarks);
export const fetchResultsPage = mocked(Services.examResults.fetchResultsPage);
export const processResults = mocked(Services.examResults.processResults);
export const approveResults = mocked(Services.examResults.approveResults);
export const sendResultsBack = mocked(Services.examResults.sendResultsBack);
export const publishResults = mocked(Services.examResults.publishResults);
export const withholdResult = mocked(Services.examResults.withholdResult);
export const fetchReportCardsPage = mocked(Services.reportCards.fetchReportCardsPage);
export const generateReportCards = mocked(Services.reportCards.generateReportCards);
export const publishReportCards = mocked(Services.reportCards.publishReportCards);
export const updateRemarks = mocked(Services.reportCards.updateRemarks);
export const fetchReportCardDownloadUrl = mocked(Services.reportCards.fetchReportCardDownloadUrl);
export const fetchSections = mocked(Services.schoolOrganization.fetchSections);
export const fetchActiveRooms = mocked(Services.rooms.fetchActiveRooms);
export const fetchAcademicSessions = mocked(Services.schoolOrganization.fetchAcademicSessions);
export const fetchTerms = mocked(Services.schoolOrganization.fetchTerms);

/** Signs in with `exams.exam.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(["exams.exam.view", ...keys]));
}

/** The `beforeEach` of every Examinations test: a view-only user, one draft exam with two subjects,
 * two sessions and one term in the current one. */
export function stubExamsServices(url = "/exams") {
  jest.clearAllMocks();
  setUrl(url);
  asUser();
  fetchExamsPage.mockResolvedValue(examPage([examRecord()]));
  fetchExam.mockResolvedValue(examRecord());
  fetchExamSubjects.mockResolvedValue([subjectRecord()]);
  fetchSittings.mockResolvedValue([]);
  fetchConflicts.mockResolvedValue([]);
  fetchAdmitCardsPage.mockResolvedValue(admitCardPage([]));
  fetchProgress.mockResolvedValue([]);
  fetchResultsPage.mockResolvedValue(resultPage([]));
  fetchReportCardsPage.mockResolvedValue(reportCardPage([]));
  fetchStudentMarks.mockResolvedValue([]);
  fetchSections.mockResolvedValue([]);
  fetchActiveRooms.mockResolvedValue([]);
  mocked(Services.staff.fetchTeachingStaffOptions).mockResolvedValue([]);
  fetchAcademicSessions.mockResolvedValue([CURRENT_SESSION, PLANNED_SESSION]);
  fetchTerms.mockResolvedValue([{ id: TERM_ID, name: "Term 1", sequence: 1 }]);
  mocked(Services.schoolOrganization.fetchClasses).mockResolvedValue([
    { id: CLASS_ID, name: "Grade 5" },
  ]);
  mocked(Services.gradingScales.fetchScalesPage).mockResolvedValue({
    items: [{ id: SCALE_ID, name: "Standard letters" }],
    pagination: { page: 1, page_size: 100, total_count: 1, total_pages: 1 },
  } as never);
  mocked(Services.curriculum.fetchCurriculumForClass).mockResolvedValue([curriculumRecord()]);
}
