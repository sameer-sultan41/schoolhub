import { fail, ok, type MockResponse } from "../envelope";
import { cursorPageOf } from "../list";
import type { MockModule } from "../router";
import { colonAction } from "./attendance-mock-utils";
import { buildPortalLeaveRequest, type PortalStore } from "./portal-store";

/** `NotFound`'s sentence, as the envelope handler sends it. */
const NOT_FOUND = "Not found.";

/** `assert_may_request_for_student`'s refusal when the caller is not the child's guardian. */
const NOT_YOUR_CHILD = "You can only request leave for your own child.";

interface LeaveBody {
  student_id?: string;
  leave_type_id?: string;
  start_date?: string;
  end_date?: string;
  day_part?: "full" | "first_half" | "second_half";
  reason?: string;
  attachment_file_id?: string | null;
}

/** A DomainRuleViolation: a 422 that names the field, as `services.submit_leave_request` sends. */
function refused(field: string, issue: string): MockResponse {
  return fail(422, issue, {
    code: "domain_rule_violation",
    details: [{ field, issue }],
  });
}

/**
 * A guardian's leave: `GET /leave-types`, `GET /leave-requests` (narrowed by `student_id`),
 * `POST /leave-requests` and `POST /leave-requests/{id}:cancel`, for the family in `store`.
 *
 * The submission applies the two rules the dashboard leans on the server for: the student must
 * be one of the caller's children (422 on `student_id`) and a type that `requires_attachment`
 * needs a file (422 on `attachment_file_id`). Whether a file is the caller's own is the Django
 * suite's job. A new request is `pending`, and `:cancel` moves a pending one to `cancelled`.
 */
export function portalLeaveModule(store: PortalStore): MockModule {
  return (api) => {
    api.get("/leave-types", (request) => cursorPageOf(store.leaveTypes, request.searchParams));

    api.get("/leave-requests", (request) => {
      const studentId = request.searchParams.get("student_id");
      const rows = store.leaveRequests
        .filter((row) => !studentId || row.student_id === studentId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return cursorPageOf(rows, request.searchParams);
    });

    api.post("/leave-requests", (request) => {
      const body = request.json() as LeaveBody;
      const child = store.children.find((candidate) => candidate.student.id === body.student_id);
      if (!child) return refused("student_id", NOT_YOUR_CHILD);
      const type = store.leaveTypes.find((candidate) => candidate.id === body.leave_type_id);
      if (!type) return refused("leave_type_id", "Invalid pk - object does not exist.");
      if (type.requires_attachment && !body.attachment_file_id) {
        return refused("attachment_file_id", `'${type.name}' requires a supporting document.`);
      }
      store.leaveSubmissions.push({ ...body });
      const created = buildPortalLeaveRequest({
        id: `00000000-0000-4000-b000-0000000008${String(store.leaveRequests.length).padStart(2, "0")}`,
        student_id: child.student.id,
        student_name: `${child.student.first_name} ${child.student.last_name}`,
        leave_type_id: type.id,
        leave_type_name: type.name,
        start_date: body.start_date ?? "",
        end_date: body.end_date ?? "",
        day_part: body.day_part ?? "full",
        reason: body.reason ?? "",
        attachment_file_id: body.attachment_file_id ?? null,
        created_at: new Date().toISOString(),
      });
      store.leaveRequests.push(created);
      return ok(created, { status: 201 });
    });

    api.post("/leave-requests/:requestAction", (request) => {
      const { id, action } = colonAction(request.params["requestAction"]);
      const row = store.leaveRequests.find((candidate) => candidate.id === id);
      if (action !== "cancel" || !row) return fail(404, NOT_FOUND);
      // `cancel_leave_request`: a rejected or cancelled request is a 409 (an approved one may
      // still be cancelled; the start-date refusal is not modelled, the stub holds no clock).
      if (row.status === "rejected" || row.status === "cancelled") {
        return fail(409, `This request was already ${row.status}.`);
      }
      row.status = "cancelled";
      return ok(row);
    });
  };
}
