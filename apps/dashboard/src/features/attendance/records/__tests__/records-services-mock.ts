import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the Records tests share (see `servicesMock`). */
export function recordsServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    schoolOrganization: ["fetchClasses", "fetchSections"],
    studentAttendance: ["fetchAttendancePage"],
    attendanceCorrections: ["requestCorrection"],
  });
}
