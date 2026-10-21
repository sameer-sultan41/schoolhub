import { id, ORG_IDS } from "@/data/factories";
import { fail, ok, paginated } from "../envelope";
import { nameOf, type Named } from "../list";
import type { MockModule } from "../router";

/** The generated `TimetableSlot` wire shape. */
export interface Slot {
  id: string;
  academic_session_id: string;
  section_id: string;
  section_name: string;
  campus_id: string;
  day_of_week: number;
  period_id: string;
  period_name: string;
  period_sequence: number;
  start_time: string;
  end_time: string;
  subject_id: string | null;
  subject_name: string | null;
  staff_id: string | null;
  staff_name: string | null;
  room_id: string | null;
  room_name: string | null;
  status: "draft" | "published";
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conflict {
  type: string;
  severity: "hard" | "soft";
  slot_ids: string[];
  message: string;
}

export function buildSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: id("slot"),
    academic_session_id: ORG_IDS.currentSession,
    section_id: ORG_IDS.sectionA,
    section_name: "A",
    campus_id: ORG_IDS.mainCampus,
    day_of_week: 0,
    period_id: "",
    period_name: "Period 1",
    period_sequence: 1,
    start_time: "08:00:00",
    end_time: "08:45:00",
    subject_id: null,
    subject_name: null,
    staff_id: null,
    staff_name: null,
    room_id: null,
    room_name: null,
    status: "draft",
    effective_from: null,
    effective_to: null,
    notes: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

export interface TimetableGridOptions {
  slots?: Slot[];
  /** `(section, subject, staff)` rows that count as allocated; any other teacher on a subject
   * is the server's hard `teacher_not_allocated` finding. */
  allocations?: { section_id: string; subject_id: string; staff_id: string }[];
  /** For a written cell's names. */
  periods?: (Named & { sequence: number; start_time: string; end_time: string })[];
  subjects?: Named[];
  staff?: Named[];
  rooms?: Named[];
}

/** `slots/services.assert_slot_writable`'s refusal, word for word. */
const PUBLISHED_IN_PLACE =
  "This slot is published. Edit the draft and republish rather than changing it in place.";

/** The server's wording for `teacher_not_allocated` (`slots/conflicts.py`). */
const NOT_ALLOCATED =
  "This teacher has no allocation for this section and subject. Allocate them in academics first.";

/**
 * `/timetable-slots` (list, create, update, delete) and `/timetables/{section}:validate|:publish`.
 *
 * Mirrors the rules the grid surfaces: every write answers with the section's conflicts in
 * `meta`; a published cell refuses PATCH/DELETE with 409; publish refuses hard findings with a
 * 422 whose `error.meta.conflicts` holds them, and otherwise flips drafts live, end-dating the
 * published cells they replace. The only finding modelled is `teacher_not_allocated`.
 */
export function timetableGridModule(options: TimetableGridOptions = {}): MockModule {
  return (api) => {
    const slots = [...(options.slots ?? [])];
    const allocations = options.allocations ?? [];
    const periods = options.periods ?? [];
    const named = (list: Named[] | undefined, itemId: string | null) =>
      itemId ? nameOf(list ?? [], itemId) : null;

    const current = (sectionId: string) =>
      slots.filter((slot) => slot.section_id === sectionId && slot.effective_to === null);
    // One finding per missing (subject, teacher) allocation, naming every cell it covers, as
    // `conflicts._unallocated_teachers` groups them.
    const conflictsFor = (sectionId: string): Conflict[] => {
      const missing = new Map<string, string[]>();
      for (const slot of current(sectionId)) {
        if (slot.subject_id === null || slot.staff_id === null) continue;
        const allocated = allocations.some(
          (row) =>
            row.section_id === sectionId &&
            row.subject_id === slot.subject_id &&
            row.staff_id === slot.staff_id,
        );
        if (allocated) continue;
        const key = `${slot.subject_id}:${slot.staff_id}`;
        missing.set(key, [...(missing.get(key) ?? []), slot.id]);
      }
      return [...missing.values()].map((slotIds) => ({
        type: "teacher_not_allocated",
        severity: "hard",
        slot_ids: slotIds.sort(),
        message: NOT_ALLOCATED,
      }));
    };
    const withNames = (slot: Slot): Slot => {
      const period = periods.find((candidate) => candidate.id === slot.period_id);
      return {
        ...slot,
        period_name: period?.name ?? slot.period_name,
        period_sequence: period?.sequence ?? slot.period_sequence,
        start_time: period?.start_time ?? slot.start_time,
        end_time: period?.end_time ?? slot.end_time,
        subject_name: named(options.subjects, slot.subject_id),
        staff_name: named(options.staff, slot.staff_id),
        room_name: named(options.rooms, slot.room_id),
      };
    };

    api.get("/timetable-slots", (request) => {
      const params = request.searchParams;
      const sectionId = params.get("section_id");
      const sessionId = params.get("academic_session_id");
      const onlyCurrent = params.get("current") === "true";
      // The cover dialog's "their classes that day" read.
      const teacherId = params.get("teacher_id");
      const weekday = params.get("weekday");
      const status = params.get("status");
      return paginated(
        slots.filter(
          (slot) =>
            (!sectionId || slot.section_id === sectionId) &&
            (!sessionId || slot.academic_session_id === sessionId) &&
            (!onlyCurrent || slot.effective_to === null) &&
            (!teacherId || slot.staff_id === teacherId) &&
            (weekday === null || String(slot.day_of_week) === weekday) &&
            (!status || slot.status === status),
        ),
      );
    });

    api.post("/timetable-slots", (request) => {
      const body = request.json() as Partial<Slot> | null;
      if (!body?.section_id || !body.period_id) return fail(400, "Validation failed.");
      const created = withNames(buildSlot({ ...body, status: "draft" }));
      slots.push(created);
      return ok(created, { status: 201, meta: { conflicts: conflictsFor(created.section_id) } });
    });

    api.patch("/timetable-slots/:slotId", (request) => {
      const match = slots.find((slot) => slot.id === request.params["slotId"]);
      if (!match) return fail(404, "Not found.");
      if (match.status === "published") {
        return fail(409, PUBLISHED_IN_PLACE);
      }
      Object.assign(match, withNames({ ...match, ...(request.json() as Partial<Slot>) }));
      return ok(match, { meta: { conflicts: conflictsFor(match.section_id) } });
    });

    api.delete("/timetable-slots/:slotId", (request) => {
      const index = slots.findIndex((slot) => slot.id === request.params["slotId"]);
      const match = slots[index];
      if (!match) return fail(404, "Not found.");
      if (match.status === "published") return fail(409, PUBLISHED_IN_PLACE);
      slots.splice(index, 1);
      return ok(null, { meta: { conflicts: conflictsFor(match.section_id) } });
    });

    // `:target` captures "<section id>:validate" whole (router params stop only at `/`).
    api.post("/timetables/:target", (request) => {
      const [sectionId = "", action] = (request.params["target"] ?? "").split(":");
      const body = (request.json() as { academic_session_id?: string } | null) ?? {};
      const found = conflictsFor(sectionId);
      if (action === "validate") {
        return ok({
          section_id: sectionId,
          academic_session_id: body.academic_session_id ?? ORG_IDS.currentSession,
          conflicts: found,
          has_hard_conflicts: found.some((finding) => finding.severity === "hard"),
        });
      }
      if (action !== "publish") return fail(404, "Not found.");
      if (found.some((finding) => finding.severity === "hard")) {
        const message = "This timetable has unresolved hard conflicts and cannot be published.";
        const refused = fail(422, message, {
          code: "domain_rule_violation",
          details: [{ field: "non_field", issue: message }],
        });
        return {
          ...refused,
          body: { error: { ...refused.body.error, meta: { conflicts: found } } },
        };
      }
      const drafts = current(sectionId).filter((slot) => slot.status === "draft");
      if (drafts.length === 0) {
        const message = "There is no draft timetable for this section to publish.";
        return fail(422, message, {
          code: "domain_rule_violation",
          details: [{ field: "non_field", issue: message }],
        });
      }
      let superseded = 0;
      for (const draft of drafts) {
        for (const live of current(sectionId)) {
          if (
            live.status === "published" &&
            live.day_of_week === draft.day_of_week &&
            live.period_id === draft.period_id
          ) {
            live.effective_to = "2026-09-02";
            superseded += 1;
          }
        }
        draft.status = "published";
        draft.effective_from = "2026-09-02";
      }
      return ok(
        { published: drafts.length, superseded, conflicts: [] },
        { meta: { message: "Timetable published." } },
      );
    });
  };
}
