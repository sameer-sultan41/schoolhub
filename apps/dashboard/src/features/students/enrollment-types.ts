/**
 * Hand-declared wire types for the enrollment lifecycle (enroll/change-section/
 * withdraw, transfers, history) — same convention as student-types.ts.
 */

export type EnrollmentStatus =
  "active" | "promoted" | "retained" | "transferred_out" | "withdrawn" | "graduated";

export interface StudentEnrollmentRecord {
  id: string;
  student_id: string;
  academic_session_id: string;
  class_id: string;
  section_id: string;
  roll_number: string | null;
  enrollment_date: string;
  end_date: string | null;
  status: EnrollmentStatus;
  created_at: string;
  updated_at: string;
}

export type TransferType = "inter_campus" | "outgoing" | "incoming";

export type TransferStatus = "requested" | "approved" | "rejected" | "completed" | "cancelled";

export interface StudentTransferRecord {
  id: string;
  student_id: string;
  transfer_type: TransferType;
  from_campus_id: string | null;
  to_campus_id: string | null;
  external_school_name: string | null;
  reason: string;
  status: TransferStatus;
  effective_date: string;
  decided_by: string | null;
  decided_at: string | null;
  certificate_document_id: string | null;
  created_at: string;
  updated_at: string;
}

interface HistoryEventBase {
  id: string;
  date: string;
  status: string;
}

export interface EnrollmentHistoryEvent extends HistoryEventBase {
  type: "enrollment";
  academic_session_id: string;
  academic_session_name: string;
  class_id: string;
  class_name: string;
  section_id: string;
  section_name: string;
  roll_number: string | null;
}

export interface TransferHistoryEvent extends HistoryEventBase {
  type: "transfer";
  transfer_type: TransferType;
  from_campus_id: string | null;
  from_campus_name: string | null;
  to_campus_id: string | null;
  to_campus_name: string | null;
  external_school_name: string | null;
  reason: string;
}

export type HistoryEvent = EnrollmentHistoryEvent | TransferHistoryEvent;

export interface AcademicSessionOption {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
}

export interface ClassOption {
  id: string;
  name: string;
  level: number;
}

export interface SectionOption {
  id: string;
  name: string;
  class_id: string;
  campus_id: string;
  capacity: number | null;
}
