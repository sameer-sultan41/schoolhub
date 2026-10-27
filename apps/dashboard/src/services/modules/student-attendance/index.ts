import {
  bulkMark,
  fetchAttendancePage,
  fetchMyRegisters,
  fetchRegister,
  triggerAttendanceImport,
} from "./student-attendance-service";

export const StudentAttendanceService = {
  fetchRegister,
  fetchMyRegisters,
  fetchAttendancePage,
  bulkMark,
  triggerAttendanceImport,
};
export type {
  AttendancePageQuery,
  AttendanceStatus,
  BulkMarkEntryInput,
  BulkMarkInput,
  BulkMarkMeta,
  BulkMarkResult,
  MarkableStatus,
  MyRegister,
  MyRegistersResult,
  RegisterEntry,
  RegisterMeta,
  RegisterQuery,
  RegisterResult,
  RowIssue,
  StudentAttendanceRecord,
  UnmarkableReason,
} from "./student-attendance-type";
