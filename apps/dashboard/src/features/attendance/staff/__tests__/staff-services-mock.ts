import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the Staff tests share (see `servicesMock`). */
export function staffServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    staffAttendance: [
      "fetchStaffRegister",
      "fetchStaffAttendancePage",
      "markStaffAttendance",
      "checkOutStaff",
    ],
    attendanceCorrections: ["requestCorrection"],
  });
}
