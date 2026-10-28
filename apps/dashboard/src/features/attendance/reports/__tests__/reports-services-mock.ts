import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the Reports tests share (see `servicesMock`). */
export function reportsServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    schoolOrganization: ["fetchClasses", "fetchSections"],
    periods: ["fetchCampusPeriods"],
    attendanceReports: ["runReport", "exportReport"],
    jobs: ["fetchJob", "fetchFileDownloadUrl"],
  });
}
