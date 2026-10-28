import {
  checkOutStaff,
  fetchStaffAttendancePage,
  fetchStaffRegister,
  markStaffAttendance,
} from "./staff-attendance-service";

export const StaffAttendanceService = {
  fetchStaffRegister,
  fetchStaffAttendancePage,
  markStaffAttendance,
  checkOutStaff,
};
export type {
  MarkableStaffStatus,
  MarkStaffAttendanceInput,
  StaffAttendancePageQuery,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffRegisterEntry,
  StaffRegisterQuery,
  StaffRowDraft,
} from "./staff-attendance-type";
