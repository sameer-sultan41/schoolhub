import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the exam Reports tests share (see `servicesMock`). */
export function examReportsServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    exams: ["fetchExamsPage"],
    examReports: ["runReport", "exportReport"],
    jobs: ["fetchJob", "fetchFileDownloadUrl"],
  });
}
