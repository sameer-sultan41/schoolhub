import {
  attendanceRecord,
  OTHER_STUDENT_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";

/** Ids the Records tests share. */
export const CLASS_ID = "66666666-aaaa-4bbb-8ccc-000000000001";
export const CAMPUS_ID = "55555555-aaaa-4bbb-8ccc-000000000001";
export const BILAL_RECORD_ID = "33333333-aaaa-4bbb-8ccc-000000000002";
export const SARA_RECORD_ID = "33333333-aaaa-4bbb-8ccc-000000000003";

/** A daily present row, not locked. */
export const amna = attendanceRecord();

/** A locked late arrival in period 2, imported. */
export const bilal = attendanceRecord({
  id: BILAL_RECORD_ID,
  student_id: OTHER_STUDENT_ID,
  student_name: "Bilal Khan",
  admission_number: "ADM-002",
  period_id: "11111111-aaaa-4bbb-8ccc-000000000003",
  period_name: "Period 2",
  status: "late",
  check_in_time: "08:20:00",
  late_minutes: 20,
  source: "import",
  is_locked: true,
});

/** A locked daily absence. */
export const sara = attendanceRecord({
  id: SARA_RECORD_ID,
  student_name: "Sara Ali",
  admission_number: "ADM-003",
  status: "absent",
  is_locked: true,
});
