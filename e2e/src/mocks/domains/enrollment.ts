import { id } from "@/data/factories";
import { ok } from "../envelope";
import type { MockModule } from "../router";

/** One event in `GET /students/{id}/history`'s discriminated-union response — matches
 * `EnrollmentHistoryEventSerializer`/`TransferHistoryEventSerializer` field for field. */
export type HistoryEvent = EnrollmentHistoryEvent | TransferHistoryEvent;

export interface EnrollmentHistoryEvent {
  type: "enrollment";
  id: string;
  date: string;
  status: string;
  academic_session_id: string;
  academic_session_name: string;
  class_id: string;
  class_name: string;
  section_id: string;
  section_name: string;
  roll_number: string | null;
}

export interface TransferHistoryEvent {
  type: "transfer";
  id: string;
  date: string;
  status: string;
  transfer_type: string;
  from_campus_id: string | null;
  from_campus_name: string | null;
  to_campus_id: string | null;
  to_campus_name: string | null;
  external_school_name: string | null;
  reason: string;
}

export function buildEnrollmentHistoryEvent(
  overrides: Partial<EnrollmentHistoryEvent> = {},
): EnrollmentHistoryEvent {
  return {
    type: "enrollment",
    id: id("history-enrollment"),
    date: "2026-04-05",
    status: "active",
    academic_session_id: "session-0001",
    academic_session_name: "2026-27",
    class_id: "class-0001",
    class_name: "Grade 1",
    section_id: "section-0001",
    section_name: "A",
    roll_number: null,
    ...overrides,
  };
}

export function buildTransferHistoryEvent(
  overrides: Partial<TransferHistoryEvent> = {},
): TransferHistoryEvent {
  return {
    type: "transfer",
    id: id("history-transfer"),
    date: "2026-05-01",
    status: "requested",
    transfer_type: "inter_campus",
    from_campus_id: "campus-0001",
    from_campus_name: "Main Campus",
    to_campus_id: "campus-0002",
    to_campus_name: "North Campus",
    external_school_name: null,
    reason: "Family relocation",
    ...overrides,
  };
}

export interface EnrollmentOptions {
  historyByStudentId?: Record<string, HistoryEvent[]>;
}

/** `GET /students/{id}/history` — the enroll/change-section colon-actions themselves are
 * handled by `studentsModule` (the same `:studentAction` route `:withdraw` already owns). */
export function enrollmentModule(options: EnrollmentOptions = {}): MockModule {
  return (api) => {
    const historyByStudentId = { ...(options.historyByStudentId ?? {}) };

    api.get("/students/:studentId/history", (request) => {
      const events = historyByStudentId[request.params["studentId"] ?? ""] ?? [];
      return ok(events);
    });
  };
}
