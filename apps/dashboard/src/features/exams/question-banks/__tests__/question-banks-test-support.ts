import type { PermissionKey } from "@schoolhub/types";

import { Services } from "@/services";
import {
  bankPage,
  bankRecord,
  questionPage,
  questionRecord,
  SUBJECT_ID,
} from "@/services/modules/question-banks/__tests__/question-banks-fixtures";
import { CLASS_ID } from "@/test-fixtures/academics";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, setUrl } from "@/test-utils";

/** Shared setup for the question-bank tests; each file keeps its own `jest.mock` calls. */

export { mocked, rowOf, urlParam } from "@/test-fixtures/list-screen";

export const fetchBanksPage = mocked(Services.questionBanks.fetchBanksPage);
export const fetchBank = mocked(Services.questionBanks.fetchBank);
export const createBank = mocked(Services.questionBanks.createBank);
export const updateBank = mocked(Services.questionBanks.updateBank);
export const deleteBank = mocked(Services.questionBanks.deleteBank);
export const fetchQuestionsPage = mocked(Services.questionBanks.fetchQuestionsPage);
export const createQuestion = mocked(Services.questionBanks.createQuestion);
export const updateQuestion = mocked(Services.questionBanks.updateQuestion);
export const deleteQuestion = mocked(Services.questionBanks.deleteQuestion);
export const approveQuestion = mocked(Services.questionBanks.approveQuestion);
export const assemblePaper = mocked(Services.questionBanks.assemblePaper);
export const fetchJob = mocked(Services.jobs.fetchJob);
export const fetchFileDownloadUrl = mocked(Services.jobs.fetchFileDownloadUrl);
export const fetchSubjects = mocked(Services.schoolOrganization.fetchSubjects);
export const fetchClasses = mocked(Services.schoolOrganization.fetchClasses);

/** Every question-bank key a `teacher` holds (§4): the bank keys and the approval. */
export const TEACHER_KEYS: PermissionKey[] = [
  "exams.question-bank.view",
  "exams.question-bank.create",
  "exams.question-bank.update",
  "exams.question-bank.delete",
  "exams.question.approve",
];

/** Signs in with `exams.question-bank.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["exams.question-bank.view", ...keys]),
  );
}

/** The `beforeEach` of every question-bank test: a view-only user, one bank with one question,
 * and the subject and class pickers' lists. */
export function stubQuestionBankServices(url = "/exams/question-banks") {
  jest.clearAllMocks();
  setUrl(url);
  asUser();
  fetchBanksPage.mockResolvedValue(bankPage([bankRecord()]));
  fetchBank.mockResolvedValue(bankRecord());
  fetchQuestionsPage.mockResolvedValue(questionPage([questionRecord()]));
  fetchSubjects.mockResolvedValue([{ id: SUBJECT_ID, name: "Mathematics" }]);
  fetchClasses.mockResolvedValue([{ id: CLASS_ID, name: "Grade 5" }]);
}
