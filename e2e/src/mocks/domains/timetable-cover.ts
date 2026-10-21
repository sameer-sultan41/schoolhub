import { id, ORG_IDS } from "@/data/factories";
import { fail, ok, pagedList } from "../envelope";
import type { MockModule } from "../router";

/** The generated `TeacherSubstitution` wire shape. */
export interface Substitution {
  id: string;
  timetable_slot_id: string;
  date: string;
  day_of_week: number;
  section_name: string;
  subject_name: string | null;
  period_name: string;
  absent_staff_id: string;
  absent_staff_name: string;
  substitute_staff_id: string;
  substitute_staff_name: string;
  slot_room_name: string | null;
  room_id: string | null;
  room_name: string | null;
  reason: string | null;
  leave_request_id: string | null;
  status: "proposed" | "confirmed" | "declined" | "completed" | "cancelled";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One cell of `/timetables/my`. */
export interface EffectiveSlot {
  id: string;
  day_of_week: number;
  period_id: string;
  period_name: string;
  period_sequence: number;
  start_time: string;
  end_time: string;
  section_id: string;
  section_name: string;
  subject_id: string | null;
  subject_name: string | null;
  staff_id: string | null;
  staff_name: string | null;
  room_id: string | null;
  room_name: string | null;
  notes: string | null;
  substitution: null | {
    id: string;
    date: string;
    absent_staff_id: string;
    substitute_staff_id: string;
    substitute_staff_name: string;
    room_id: string | null;
    room_name: string | null;
    reason: string | null;
  };
}

export function buildSubstitution(overrides: Partial<Substitution> = {}): Substitution {
  return {
    id: id("substitution"),
    timetable_slot_id: id("slot"),
    date: "2099-01-05",
    day_of_week: 0,
    section_name: "Grade 1 A",
    subject_name: "Mathematics",
    period_name: "Period 1",
    absent_staff_id: id("staff"),
    absent_staff_name: "Amna Raza",
    substitute_staff_id: id("staff"),
    substitute_staff_name: "Bilal Khan",
    slot_room_name: "Room 101",
    room_id: null,
    room_name: null,
    reason: null,
    leave_request_id: null,
    status: "proposed",
    created_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function buildEffectiveSlot(overrides: Partial<EffectiveSlot> = {}): EffectiveSlot {
  return {
    id: id("slot"),
    day_of_week: 0,
    period_id: id("period"),
    period_name: "Period 1",
    period_sequence: 1,
    start_time: "08:00:00",
    end_time: "08:45:00",
    section_id: ORG_IDS.sectionA,
    section_name: "Grade 1 A",
    subject_id: null,
    subject_name: "Mathematics",
    staff_id: null,
    staff_name: "Amna Raza",
    room_id: null,
    room_name: "Room 101",
    notes: null,
    substitution: null,
    ...overrides,
  };
}

export interface TimetableCoverOptions {
  substitutions?: Substitution[];
  /** What `GET /teacher-substitutions/candidates` answers, whatever it is asked. */
  candidates?: { staff_id: string; staff_name: string; employee_number: string }[];
  /** `GET /timetables/my` without a date. */
  myWeek?: EffectiveSlot[];
  /** `GET /timetables/my?date=`; falls back to `myWeek`. */
  myWeekOn?: Record<string, EffectiveSlot[]>;
  /** The signed-in user's id, for `:cancel`'s own-proposal rule. */
  userId?: string;
  /** Whether that user holds `timetable.substitution.approve`. */
  isApprover?: boolean;
}

const OPEN = ["proposed", "confirmed"];

/**
 * `/teacher-substitutions` (list, propose, `:approve`/`:reject`/`:cancel`, `candidates`) and
 * `/timetables/my`. Mirrors the server's rules the queue surfaces: only `proposed` cover is
 * decided (else 409 with `decide_substitution`'s wording), `:cancel` takes open cover (an
 * approver's) or one's own proposal, never past cover; refusals use the server's wording.
 */
export function timetableCoverModule(options: TimetableCoverOptions = {}): MockModule {
  return (api) => {
    const rows = [...(options.substitutions ?? [])];

    api.get("/teacher-substitutions/candidates", () => ok(options.candidates ?? []));

    api.get("/teacher-substitutions", (request) => {
      const params = request.searchParams;
      const status = params.get("status");
      const from = params.get("date__gte");
      const to = params.get("date__lte");
      const search = params.get("search")?.toLowerCase();
      const matching = rows.filter(
        (row) =>
          (!status || row.status === status) &&
          (!from || row.date >= from) &&
          (!to || row.date <= to) &&
          (!search ||
            `${row.absent_staff_name} ${row.substitute_staff_name}`.toLowerCase().includes(search)),
      );
      return pagedList([...matching].sort((a, b) => b.date.localeCompare(a.date)));
    });

    api.post("/teacher-substitutions", (request) => {
      const body = request.json() as Partial<Substitution> | null;
      if (!body?.timetable_slot_id) return fail(400, "Validation failed.");
      const created = buildSubstitution({
        ...body,
        status: "proposed",
        created_by: options.userId ?? null,
      });
      rows.push(created);
      return ok(created, { status: 201 });
    });

    // `:target` captures "<id>:approve" whole (router params stop only at `/`).
    api.post("/teacher-substitutions/:target", (request) => {
      const [rowId, action] = (request.params["target"] ?? "").split(":");
      const row = rows.find((candidate) => candidate.id === rowId);
      if (!row) return fail(404, "Not found.");
      if (action === "approve" || action === "reject") {
        if (row.status !== "proposed") {
          return fail(409, `This substitution is ${row.status} and cannot be decided again.`);
        }
        row.status = action === "approve" ? "confirmed" : "declined";
        return ok(row);
      }
      if (action !== "cancel") return fail(404, "Not found.");
      const ownProposal = row.created_by === options.userId;
      if (!options.isApprover && !ownProposal) {
        return fail(403, "Only an approver, or whoever proposed it, can cancel cover.");
      }
      const allowed = options.isApprover ? OPEN : ["proposed"];
      if (!allowed.includes(row.status)) {
        return fail(409, `This substitution is ${row.status} and cannot be cancelled.`);
      }
      row.status = "cancelled";
      return ok(row);
    });

    api.get("/timetables/my", (request) => {
      const date = request.searchParams.get("date");
      const week = (date ? options.myWeekOn?.[date] : undefined) ?? options.myWeek ?? [];
      return ok(week, {
        meta: { academic_session_id: ORG_IDS.currentSession, date, audience: "teacher" },
      });
    });
  };
}
