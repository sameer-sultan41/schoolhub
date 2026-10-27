import type { PermissionKey } from "@schoolhub/types";
import { fail, harnessError, ok, type MockResponse } from "../envelope";
import { compareValues, cursorPageOf } from "../list";
import type { MockModule } from "../router";
import {
  APPROVAL_MESSAGES,
  type AttendanceApprovalsStore,
  calendarDays,
  type LeaveRequestRecord,
} from "./attendance-approvals-store";
import { colonAction } from "./attendance-mock-utils";
import { refusal } from "./attendance-register";

/** `core/rbac/permissions.py`'s refusal, which runs before any lookup. */
export const PERMISSION_DENIED = "You do not have permission to perform this action.";
/** `ActionResponse.ok`'s `meta.message` for each correction decision (`views.py`). */
const CORRECTION_DECIDED_MESSAGE = {
  approve: "Correction applied.",
  reject: "Correction rejected.",
} as const;

type Decision = "approve" | "reject";

function isDecision(action: string | undefined): action is Decision {
  return action === "approve" || action === "reject";
}

/** django-filter's `BooleanFilter` reads `true`/`True`/`1` as true. */
function isTrue(value: string): boolean {
  return ["true", "True", "1"].includes(value);
}

/** DRF's `OrderingFilter` over one field, `-` for descending; `-created_at` by default. */
function ordered<T extends Record<string, unknown>>(rows: readonly T[], ordering: string | null) {
  const key = ordering || "-created_at";
  const direction = key.startsWith("-") ? -1 : 1;
  const field = key.replace(/^-/, "");
  return [...rows].sort((a, b) => direction * compareValues(a[field], b[field]));
}

/** `auto_marked_days`: the rows `apply_approved_leave` writes, one per working day in range
 * (all seven, in the e2e week), or one for a half day. */
function autoMarkedDays(request: LeaveRequestRecord): number {
  if (request.day_part && request.day_part !== "full") return 1;
  return calendarDays(request.start_date, request.end_date);
}

/**
 * `/attendance-corrections` (the queue, `:approve`, `:reject`), `/leave-requests` (the queue,
 * `:approve`, `:reject`) and `/leave-types`, for the caller in `store.user`.
 *
 * Each route checks its permission key first (403), then the record scope (404), then the
 * service's rules in the service's order with its sentences (L5):
 * - a correction: already decided (409), the caller's own request, then a staff correction
 *   about the caller (both 422 on `reviewed_by`);
 * - a leave step: already decided (409), the caller submitted it (422 on `approver_id`), no
 *   pending step (409), the caller decided an earlier level (422), then level 2 needs a campus or
 *   school-wide scope (422).
 *
 * Lists are cursor paged (`cursorPageOf`): a cursor the stub did not issue is a 404 "Invalid
 * cursor". `POST /files/{id}:download` belongs to `jobsModule` (the router has no fallthrough
 * between modules), so a spec that downloads an attachment passes it the file there.
 * `POST /attendance-corrections` (raising one) is `attendanceRegisterModule`'s.
 */
export function attendanceApprovalsModule(store: AttendanceApprovalsStore): MockModule {
  const holds = (...keys: PermissionKey[]) =>
    keys.some((key) => store.user.permissions.includes(key));
  const forbidden = (): MockResponse => fail(403, PERMISSION_DENIED);

  return (api) => {
    api.get("/attendance-corrections", (request) => {
      // `AnyOf("attendance.correction.create", "attendance.correction.approve")` (ADR-0027).
      if (!holds("attendance.correction.create", "attendance.correction.approve")) {
        return forbidden();
      }
      const params = request.searchParams;
      const mine = params.get("mine");
      const target = params.get("student_attendance_id");
      const staffTarget = params.get("staff_attendance_id");
      const rows = store.visibleCorrections().filter(
        (row) =>
          (!params.get("status") || row.status === params.get("status")) &&
          // `subject_type` is `student` or `staff`, the target's kind (`filters.py`).
          (!params.get("subject_type") || row.subject_type === params.get("subject_type")) &&
          (!target || row.student_attendance_id === target) &&
          (!staffTarget || row.staff_attendance_id === staffTarget) &&
          // `mine=false` is everyone else's: the approver's queue.
          (mine === null || isTrue(mine) === (row.requested_by === store.user.id)),
      );
      return cursorPageOf(ordered(rows, params.get("ordering")), params);
    });

    api.post("/attendance-corrections/:correctionAction", (request) => {
      const { id, action } = colonAction(request.params["correctionAction"]);
      if (!isDecision(action)) return harnessError(`No mock for correction :${action ?? ""}`);
      if (!holds("attendance.correction.approve")) return forbidden();
      const correction = store.visibleCorrections().find((row) => row.id === id);
      if (!correction) return fail(404, "Not found.");

      if (correction.status !== "pending") {
        return fail(409, APPROVAL_MESSAGES.correctionDecided(correction.status));
      }
      if (correction.requested_by === store.user.id) {
        return refusal("reviewed_by", APPROVAL_MESSAGES.ownCorrection);
      }
      if (correction.subject_user_id === store.user.id) {
        return refusal("reviewed_by", APPROVAL_MESSAGES.ownAttendance);
      }
      const body = (request.json() as { review_note?: string } | null) ?? {};
      const now = new Date().toISOString();
      correction.status = action === "approve" ? "approved" : "rejected";
      correction.reviewed_by = store.user.id;
      correction.reviewed_by_name = store.user.full_name;
      correction.reviewed_at = now;
      correction.review_note = body.review_note ?? null;
      correction.updated_at = now;
      return ok(structuredClone(correction), {
        meta: { message: CORRECTION_DECIDED_MESSAGE[action] },
      });
    });

    api.get("/leave-requests", (request) => {
      if (!holds("attendance.leave-request.view")) return forbidden();
      const params = request.searchParams;
      const from = params.get("date__gte");
      const to = params.get("date__lte");
      const rows = store.leaveRequests.filter(
        (row) =>
          (!params.get("status") || row.status === params.get("status")) &&
          (!params.get("leave_type_id") || row.leave_type_id === params.get("leave_type_id")) &&
          (!params.get("student_id") || row.student_id === params.get("student_id")) &&
          // `date__gte` reads `start_date` and `date__lte` reads `end_date` (`filters.py`).
          (!from || row.start_date >= from) &&
          (!to || row.end_date <= to),
      );
      return cursorPageOf(ordered(rows, params.get("ordering")), params);
    });

    api.post("/leave-requests/:leaveAction", (request) => {
      const { id, action } = colonAction(request.params["leaveAction"]);
      if (!isDecision(action)) return harnessError(`No mock for leave :${action ?? ""}`);
      if (!holds("attendance.leave-request.approve")) return forbidden();
      const leave = store.leaveRequest(id);
      if (!leave) return fail(404, "Not found.");

      if (leave.status !== "pending") {
        return fail(409, APPROVAL_MESSAGES.leaveDecided(leave.status));
      }
      if (leave.submitted_by === store.user.id) {
        return refusal("approver_id", APPROVAL_MESSAGES.ownLeave);
      }
      const step = leave.approvals.find((s) => s.level === leave.current_approval_level);
      if (!step) return fail(409, APPROVAL_MESSAGES.noPendingStep);
      if (leave.approvals.some((s) => s.approver_id === store.user.id)) {
        return refusal("approver_id", APPROVAL_MESSAGES.secondLevel);
      }
      if (step.level >= 2 && !store.hasWideScope()) {
        return refusal("approver_id", APPROVAL_MESSAGES.escalationScope);
      }

      const body = (request.json() as { note?: string } | null) ?? {};
      const now = new Date().toISOString();
      step.decision = action === "approve" ? "approved" : "rejected";
      step.approver_id = store.user.id;
      step.approver_name = store.user.full_name;
      step.decided_at = now;
      step.note = body.note ?? null;
      // A rejection ends the request at any level; an approval moves on, or approves the last.
      if (action === "reject") {
        leave.status = "rejected";
        leave.decided_at = now;
      } else if (leave.approvals.some((s) => s.decision === "pending")) {
        leave.current_approval_level += 1;
      } else {
        leave.status = "approved";
        leave.decided_at = now;
      }
      leave.updated_at = now;
      const marked = leave.status === "approved" ? autoMarkedDays(leave) : 0;
      return ok(structuredClone(leave), { meta: { auto_marked_days: marked } });
    });

    api.get("/leave-types", (request) => {
      if (!holds("attendance.leave-request.view")) return forbidden();
      const params = request.searchParams;
      const active = params.get("is_active");
      const rows = store.leaveTypes.filter(
        (type) =>
          (!params.get("applies_to") || type.applies_to === params.get("applies_to")) &&
          (active === null || type.is_active === isTrue(active)),
      );
      return cursorPageOf(ordered(rows, params.get("ordering") ?? "name"), params);
    });
  };
}
