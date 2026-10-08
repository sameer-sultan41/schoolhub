import { id } from "@/data/factories";
import { fail, ok, paginated } from "../envelope";
import type { MockModule } from "../router";

/** The generated wire shape, trimmed to what the Enrollment tab reads. */
export interface StudentTransfer {
  id: string;
  student_id: string;
  transfer_type: "inter_campus" | "outgoing" | "incoming";
  from_campus_id: string | null;
  to_campus_id: string | null;
  external_school_name: string | null;
  reason: string;
  status: "requested" | "approved" | "rejected" | "completed" | "cancelled";
  effective_date: string;
  decided_by: string | null;
  decided_at: string | null;
  certificate_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export function buildStudentTransfer(overrides: Partial<StudentTransfer> = {}): StudentTransfer {
  return {
    id: id("transfer"),
    student_id: "",
    transfer_type: "inter_campus",
    from_campus_id: "campus-0001",
    to_campus_id: "campus-0002",
    external_school_name: null,
    reason: "Family relocation",
    status: "requested",
    effective_date: "2026-05-01",
    decided_by: null,
    decided_at: null,
    certificate_document_id: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

export interface StudentTransfersOptions {
  transfers?: StudentTransfer[];
}

/** `GET/POST /student-transfers` plus the `:approve`/`:reject`/`:complete` colon-actions —
 * a top-level resource from the start, matching the real registered routes
 * (`apps/dashboard/src/services/endpoints.ts`'s `studentTransfers` block). */
export function studentTransfersModule(options: StudentTransfersOptions = {}): MockModule {
  return (api) => {
    const transfers = [...(options.transfers ?? [])];

    api.get("/student-transfers", (request) => {
      const studentId = request.searchParams.get("student_id");
      const rows = studentId ? transfers.filter((t) => t.student_id === studentId) : transfers;
      return paginated(rows);
    });

    api.post("/student-transfers", (request) => {
      const body = (request.json() as Partial<StudentTransfer> | null) ?? {};
      const created = buildStudentTransfer({ ...body, id: id("transfer") });
      transfers.push(created);
      return ok(created, { status: 201 });
    });

    api.post("/student-transfers/:transferAction", (request) => {
      const [transferId, action] = (request.params["transferAction"] ?? "").split(":");
      const match = transfers.find((t) => t.id === transferId);
      if (!match) return fail(404, "Not found.");

      if (action === "approve") {
        if (match.status !== "requested") return fail(409, "Already decided.");
        Object.assign(match, {
          status: "approved",
          decided_by: "user-decision",
          decided_at: "2026-04-15T00:00:00Z",
        });
        return ok(match);
      }
      if (action === "reject") {
        if (match.status !== "requested") return fail(409, "Already decided.");
        Object.assign(match, {
          status: "rejected",
          decided_by: "user-decision",
          decided_at: "2026-04-15T00:00:00Z",
        });
        return ok(match);
      }
      if (action === "complete") {
        if (match.status !== "approved") return fail(409, "Not yet approved.");
        Object.assign(match, { status: "completed" });
        return ok(match);
      }
      return fail(404, "Not found.");
    });
  };
}
