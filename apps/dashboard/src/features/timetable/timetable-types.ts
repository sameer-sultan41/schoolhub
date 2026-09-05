/**
 * Hand-declared wire types for the timetable API — same convention as
 * academics-types.ts / staff-types.ts: snake_case fields mirroring the DRF
 * serializers, and never an import of the generated `schema.d.ts` (the timetable
 * paths are not in packages/api-client/src/schema.d.ts).
 *
 * Source of truth: apps/api/apps/timetable/models.py, conflicts.py and
 * services.py, plus docs/03-modules/timetable.md §16. The serializers were being
 * written concurrently with this screen, so where §16 left a response shape
 * genuinely open the choice below is noted inline — every one of them follows
 * what the model or the service's return value implies.
 */

/** models.RoomType. */
export type RoomTypeValue =
  "classroom" | "lab" | "library" | "auditorium" | "sports" | "office" | "other";

/** models.SlotStatus. Draft is what `timetable.slot.view` gates; published is
 * what everyone with `timetable.timetable.view` may read. */
export type SlotStatusValue = "draft" | "published";

/** models.SubstitutionStatus. */
export type SubstitutionStatusValue =
  "proposed" | "confirmed" | "declined" | "completed" | "cancelled";

/** conflicts.Severity — `hard` blocks publish (§11), `soft` only warns. */
export type ConflictSeverity = "hard" | "soft";

/**
 * One finding from conflicts.Conflict.as_dict(). `slot_ids` names *every* slot
 * involved, not only the one just edited, which is what lets the grid highlight
 * both sides of a double booking.
 */
export interface TimetableConflict {
  type: string;
  severity: ConflictSeverity;
  slot_ids: string[];
  message: string;
}

/** Mirrors models.Period. `weekdays` is a JSON column: 0-6, null = the tenant's
 * working days. `start_time`/`end_time` arrive as "HH:MM:SS" (DRF TimeField). */
export interface PeriodRecord {
  id: string;
  campus_id: string | null;
  name: string;
  sequence: number;
  start_time: string;
  end_time: string;
  is_break: boolean;
  weekdays: number[] | null;
  created_at: string;
  updated_at: string;
}

/** Mirrors models.Room. */
export interface RoomRecord {
  id: string;
  campus_id: string;
  name: string;
  code: string;
  room_type: RoomTypeValue;
  capacity: number | null;
  building: string | null;
  floor: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Mirrors models.TimetableSlot — one cell of (session, section, weekday, period).
 * `subject_id` and `staff_id` are nullable because a homeroom or assembly slot
 * has neither. */
export interface TimetableSlotRecord {
  id: string;
  academic_session_id: string;
  section_id: string;
  day_of_week: number;
  period_id: string;
  subject_id: string | null;
  staff_id: string | null;
  room_id: string | null;
  status: SlotStatusValue;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `POST /timetables/{section_id}:validate` — §16 says only "returns conflict
 * list", so the API may reasonably answer with either a bare array or an object
 * wrapping one. `readConflicts()` below accepts both rather than betting on one.
 */
export interface ValidationResult {
  conflicts: TimetableConflict[];
}

/** `POST /timetables/{section_id}:publish` — services.publish_section_timetable's
 * return value, verbatim. A *successful* publish still carries `conflicts`: soft
 * ones do not block, and the user should still see them. */
export interface PublishResult {
  published: number;
  superseded: number;
  conflicts: TimetableConflict[];
}

/** Mirrors models.TeacherSubstitution. */
export interface SubstitutionRecord {
  id: string;
  timetable_slot_id: string;
  date: string;
  absent_staff_id: string;
  substitute_staff_id: string;
  reason: string | null;
  leave_request_id: string | null;
  status: SubstitutionStatusValue;
  created_at: string;
  updated_at: string;
}

/**
 * One row of `GET /timetables/my`.
 *
 * This screen is reached by students and guardians as well as teachers, and none
 * of them can call `/sections`, `/subjects` or `/staff` to resolve an id into a
 * name — `timetable.timetable.view` is the only key they hold. So the endpoint
 * has to return display names alongside the ids, which is what
 * `services.effective_slots_for`'s `select_related("period", "subject", "staff",
 * "room", "section")` is already fetching.
 *
 * `substitution` is a nested overlay, not a set of flat `substitute_*` columns —
 * `EffectiveSlotSerializer.get_substitution` returns the object or null, and a
 * client reading a flat field reads `undefined` on every cell, including the
 * covered ones.
 */
export interface MyTimetableSlot {
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
  substitution: MyTimetableSubstitution | null;
}

/**
 * The substitution overlay on one cell — apps.timetable.serializers'
 * `SlotSubstitutionSerializer`.
 *
 * Present only when a *confirmed* substitution covers this cell on the requested
 * date (§7.2 — a substitution overrides one cell for specific dates only), so it
 * is null on the base grid. It carries the room as well as the teacher: §6's
 * ad-hoc room change moves the class for that date, and a client that renders
 * the slot's own room sends the student somewhere the class is not. A null
 * `room_id` here means "keep the slot's room", not "no room".
 */
export interface MyTimetableSubstitution {
  id: string;
  date: string;
  absent_staff_id: string;
  substitute_staff_id: string;
  substitute_staff_name: string;
  room_id: string | null;
  room_name: string | null;
  reason: string | null;
}

/** `GET /timetables/my` — the caller's effective week. `date` echoes the query
 * parameter so the client can tell a dated answer from the base grid. */
export interface MyTimetable {
  academic_session_id: string | null;
  date: string | null;
  slots: MyTimetableSlot[];
}

/** Option subset of apps.school_organization.serializers.SectionSerializer. */
export interface SectionOption {
  id: string;
  name: string;
  class_id: string;
  campus_id?: string | null;
}

/** Option subset of apps.school_organization.serializers.SubjectSerializer. */
export interface SubjectOption {
  id: string;
  name: string;
  code: string;
}

/** Option subset of apps.staff_management.serializers.StaffSerializer. */
export interface TeachingStaffOption {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
}

/** Option subset of apps.school_organization.serializers.CampusSerializer. */
export interface CampusOption {
  id: string;
  name: string;
  code: string;
}

function isConflict(value: unknown): value is TimetableConflict {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    (candidate.severity === "hard" || candidate.severity === "soft") &&
    Array.isArray(candidate.slot_ids) &&
    typeof candidate.message === "string"
  );
}

/**
 * Pull a conflict list out of whatever the API answered with.
 *
 * `:validate` may hand back the bare list `detect_conflicts` returns or an object
 * wrapping it; a slot write carries the same list in `meta.conflicts`; a publish
 * carries it in its own body. One reader for all three keeps the three call sites
 * from each guessing differently — and anything unrecognisable degrades to an
 * empty list rather than crashing a grid the user is mid-edit in.
 */
export function readConflicts(source: unknown): TimetableConflict[] {
  if (Array.isArray(source)) return source.filter(isConflict);
  if (typeof source === "object" && source !== null) {
    const conflicts = (source as { conflicts?: unknown }).conflicts;
    if (Array.isArray(conflicts)) return conflicts.filter(isConflict);
  }
  return [];
}
