import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the Reports tests share (see `servicesMock`). */
export function reportsServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    financeReports: ["fetchReport", "exportReport", "fetchStudentStatement"],
    students: ["fetchStudentById"],
    jobs: ["fetchJob", "fetchFileDownloadUrl"],
    schoolOrganization: ["fetchAcademicSessions", "fetchClasses"],
    dashboard: ["fetchCampuses"],
  });
}
