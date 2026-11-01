import type { PermissionKey } from "@schoolhub/types";

import { Services } from "@/services";
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
