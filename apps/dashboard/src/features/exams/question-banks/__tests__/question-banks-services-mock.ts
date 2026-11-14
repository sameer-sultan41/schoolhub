import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the question-bank tests share: each test file's `jest.mock` factory
 * reaches it through `jest.requireActual`. */
export function questionBanksServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    questionBanks: [
      "fetchBanksPage",
      "fetchBank",
      "createBank",
      "updateBank",
      "deleteBank",
      "fetchQuestionsPage",
      "createQuestion",
      "updateQuestion",
      "deleteQuestion",
      "approveQuestion",
      "assemblePaper",
    ],
    jobs: ["fetchJob", "fetchFileDownloadUrl"],
    schoolOrganization: ["fetchSubjects", "fetchClasses"],
  });
}
