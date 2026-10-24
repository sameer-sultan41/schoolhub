import { isUuid } from "@/lib/helpers";
import type { ConflictSeverity, SlotInput } from "./timetable-slots-type";

/** The timetable-slots module's constants. */

/** The query-key module every grid read lives under; a slot write invalidates it. */
export const TIMETABLE_SLOTS_QUERY_MODULE = "timetable-slots";
export const TIMETABLE_GRID_RESOURCE = "grid";
/** One teacher's classes on a weekday (the propose-cover form): a publish refreshes it too. */
export const TEACHER_CLASSES_RESOURCE = "teacher-classes";

/** A unique slot-list order: `period_sequence` ties across weekdays and between a draft and
 * the published row it replaces, and a cursor over tied rows can skip or repeat one. */
export const SLOT_LIST_ORDERING = "period_sequence,day_of_week,created_at";

/** A live timetable cell's `status`. */
export const SLOT_STATUS_PUBLISHED = "published";

/** Monday (0) to Sunday (6), the API's `day_of_week`. */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Monday to Friday: the columns a week shows before any weekend day has a cell. */
export const DEFAULT_VISIBLE_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4];

/** The grid's URL keys: the session (`""` = the current one), then class, then section. */
export const GRID_URL_KEYS = { session: "session", class: "class", section: "section" } as const;

/** Validates a URL id before it reaches the API. */
export const isGridUrlId = isUuid;

/** A `conflicts.detect_conflicts` severity the server sends; anything else counts as hard,
 * so an unknown kind blocks rather than slips through as a warning. */
export const CONFLICT_SEVERITIES: readonly ConflictSeverity[] = ["hard", "soft"];

/** How far a pointer must travel before a press on a drag handle becomes a drag, so a tap on
 * the handle is never mistaken for one. */
export const DRAG_ACTIVATION_DISTANCE = 8;

/** Longest per-cell note (`timetable.models.TimetableSlot.notes`). */
export const SLOT_NOTES_MAX = 200;

/** The cell form's select stand-in for "none" (a `SelectItem` can't hold `""`). */
export const SLOT_NONE = "none";

/** camelCase `SlotInput` key -> the API body key. */
export const SLOT_BODY_FIELDS: ReadonlyArray<readonly [keyof SlotInput, string]> = [
  ["academicSessionId", "academic_session_id"],
  ["sectionId", "section_id"],
  ["dayOfWeek", "day_of_week"],
  ["periodId", "period_id"],
  ["subjectId", "subject_id"],
  ["staffId", "staff_id"],
  ["roomId", "room_id"],
  ["notes", "notes"],
];

/** Fields a server error may name in the cell form; any other is the form's own message. */
export const SLOT_ERROR_FIELDS = ["subject_id", "staff_id", "room_id", "notes"] as const;
