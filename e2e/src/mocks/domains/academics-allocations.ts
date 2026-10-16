import { id, ORG_IDS, uuid } from "@/data/factories";
import { fail, noContent, ok } from "../envelope";
import { compareValues, lockedSessionResponse, nameOf, pageOf, type Named } from "../list";
import type { MockModule } from "../router";
import type { Curriculum } from "./academics-curriculum";
import type { AcademicSession, Section } from "./school-organization";
import type { Staff } from "./staff";

/** The generated `TeacherAllocation` wire shape, trimmed to what the table and its dialogs
 * read. */
export interface Allocation {
  id: string;
  academic_session_id: string;
  section_id: string;
  subject_id: string;
  staff_id: string;
  is_primary: boolean;
  /** `null` is "no override": the curriculum's own periods apply. */
  weekly_periods: number | null;
  effective_from: string | null;
  /** `null` while in force; a date once ended. */
  effective_to: string | null;
  class_id: string;
  class_name: string;
  section_name: string;
  subject_name: string;
  staff_name: string;
  created_at: string;
  updated_at: string;
}

export function buildAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: id("allocation"),
    academic_session_id: ORG_IDS.currentSession,
    section_id: ORG_IDS.sectionA,
    // UUIDs: the teacher and subject filters take only a UUID from the URL.
    subject_id: uuid(),
    staff_id: uuid(),
    is_primary: true,
    weekly_periods: null,
    effective_from: null,
    effective_to: null,
    class_id: ORG_IDS.grade1,
    class_name: "Grade 1",
    section_name: "A",
    subject_name: "Mathematics",
    staff_name: "Bilal Ahmed",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

/** One row of `GET /teacher-subject-allocations/load-summary`. */
interface LoadRow {
  staff_id: string;
  name: string;
  weekly_periods: number;
  allocations: number;
  norm: number;
  over_norm: boolean;
}

interface LoadWarning {
  code: "teacher_over_norm";
  staff_id: string;
  weekly_periods: number;
  norm: number;
}

export interface AcademicsAllocationsOptions {
  rows?: Allocation[];
  /** The sessions `schoolOrganizationModule` serves: the source of the closed-session lock the
   * real API enforces on every write. */
  sessions?: AcademicSession[];
  /** The reference lists `schoolOrganizationModule` and `staffModule` serve, for the names on
   * a created row. */
  sections?: Section[];
  classes?: Named[];
  subjects?: Named[];
  staff?: Staff[];
  /** The rows `academicsCurriculumModule` serves: the periods an allocation with no override
   * counts for in the load summary. */
  curriculum?: Curriculum[];
}

interface AllocationBody {
  academic_session_id: string;
  section_id: string;
  subject_id: string;
  staff_id: string;
  is_primary?: boolean;
  weekly_periods?: number | null;
  effective_from?: string | null;
  effective_to?: string | null;
}

type AllocationPatch = Partial<
  Pick<Allocation, "is_primary" | "weekly_periods" | "effective_from" | "effective_to">
>;

/** Mirrors `DEFAULT_WEEKLY_PERIOD_NORM` in `teacher_allocations/services.py`, the norm every
 * load row reports. */
const WEEKLY_PERIOD_NORM = 30;

/** The server's "today": it runs on UTC, as the dashboard's `todayIsoDate()` does. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `/teacher-subject-allocations` — the allocation list, create, update and delete, plus
 * `GET /teacher-subject-allocations/load-summary`.
 *
 * Stateful: a POST adds a row, a PATCH `{effective_to}` ends one, `{effective_to: null}`
 * reinstates it, a DELETE removes it, and the list honours `current` — so the load panel and
 * the Current/Ended filter round-trip the way the real API's do. Every POST and PATCH answers
 * `{data, meta: {warnings}}`, the warning derived from the same load the summary reports.
 *
 * Not modelled (the API's own tests and the `live` lane cover them): that the staff member is
 * active teaching staff, that the subject is in the class's curriculum, and the one-primary
 * displacement of §6.
 *
 * `GET /academic-sessions`, `/classes`, `/sections`, `/subjects`, `/staff` and `/class-subjects`
 * stay in `schoolOrganizationModule`, `staffModule` and `academicsCurriculumModule`; a spec
 * passes the same lists to each.
 *
 * A spec opts in with `mockApi.use(academicsAllocationsModule({ rows, sessions, ... }))`.
 */
export function academicsAllocationsModule(options: AcademicsAllocationsOptions = {}): MockModule {
  return (api) => {
    const rows = [...(options.rows ?? [])];
    const sessions = options.sessions ?? [];
    const sections = options.sections ?? [];
    const classes = options.classes ?? [];
    const subjects = options.subjects ?? [];
    const staff = options.staff ?? [];
    const curriculum = options.curriculum ?? [];

    // Read at call time, so it sees every write made so far.
    const warningsFor = (allocation: Allocation): LoadWarning[] => {
      const summary = loadSummary(rows, curriculum, allocation.academic_session_id);
      const entry = summary.find((candidate) => candidate.staff_id === allocation.staff_id);
      const load = entry?.weekly_periods ?? 0;
      if (load <= WEEKLY_PERIOD_NORM) return [];
      return [
        {
          code: "teacher_over_norm",
          staff_id: allocation.staff_id,
          weekly_periods: load,
          norm: WEEKLY_PERIOD_NORM,
        },
      ];
    };

    api.get("/teacher-subject-allocations", (request) =>
      pageOf(filterAndOrder(rows, request.searchParams), request.searchParams),
    );

    api.get("/teacher-subject-allocations/load-summary", (request) => {
      const sessionId = request.searchParams.get("academic_session_id");
      if (!sessionId) {
        return fail(422, "Validation failed.", {
          code: "domain_rule_violation",
          details: [{ field: "academic_session_id", issue: "This field is required." }],
        });
      }
      return ok(loadSummary(rows, curriculum, sessionId));
    });

    api.post("/teacher-subject-allocations", (request) => {
      const body = request.json() as AllocationBody | null;
      if (!body) return fail(400, "Validation failed.");
      // A date is refused (an allocation is never created already ended); a `null` is a no-op.
      if (body.effective_to != null) {
        return fail(400, "Validation failed.", {
          details: [
            { field: "effective_to", issue: "An allocation cannot be created already ended." },
          ],
        });
      }
      const locked = lockedSessionResponse(sessions, body.academic_session_id);
      if (locked) return locked;

      const section = sections.find((candidate) => candidate.id === body.section_id);
      const teacher = staff.find((candidate) => candidate.id === body.staff_id);
      // No `id` in the overrides: the server assigns it, so a client-supplied one never wins.
      const created = buildAllocation({
        academic_session_id: body.academic_session_id,
        section_id: body.section_id,
        subject_id: body.subject_id,
        staff_id: body.staff_id,
        is_primary: body.is_primary ?? true,
        weekly_periods: body.weekly_periods ?? null,
        effective_from: body.effective_from ?? null,
        class_id: section?.class_id ?? "",
        class_name: nameOf(classes, section?.class_id) ?? "",
        section_name: section?.name ?? "",
        subject_name: nameOf(subjects, body.subject_id) ?? "",
        staff_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : "",
      });
      // `tsa_unique_allocation` counts ended rows too, which is why Reinstate exists.
      if (isDuplicate(rows, created)) {
        return fail(409, "That teacher is already allocated to this subject in this section.");
      }
      rows.push(created);
      return ok(created, { status: 201, meta: { warnings: warningsFor(created) } });
    });

    api.patch("/teacher-subject-allocations/:allocationId", (request) => {
      const match = rows.find((row) => row.id === request.params["allocationId"]);
      if (!match) return fail(404, "Not found.");
      const locked = lockedSessionResponse(sessions, match.academic_session_id);
      if (locked) return locked;

      const body = (request.json() as AllocationPatch | null) ?? {};
      // An end date after today is refused, as the load summary would drop the row early.
      if (typeof body.effective_to === "string" && body.effective_to > todayUtc()) {
        return fail(400, "Validation failed.", {
          details: [{ field: "effective_to", issue: "An allocation cannot end in the future." }],
        });
      }
      Object.assign(match, body, { updated_at: "2026-09-02T00:00:00Z" });
      return ok(match, { meta: { warnings: warningsFor(match) } });
    });

    api.delete("/teacher-subject-allocations/:allocationId", (request) => {
      const index = rows.findIndex((row) => row.id === request.params["allocationId"]);
      const match = rows[index];
      if (!match) return fail(404, "Not found.");
      const locked = lockedSessionResponse(sessions, match.academic_session_id);
      if (locked) return locked;
      rows.splice(index, 1);
      return noContent();
    });
  };
}

/** Whether `candidate`'s session, section, subject and teacher already have a row, ended or not. */
function isDuplicate(rows: Allocation[], candidate: Allocation): boolean {
  return rows.some(
    (row) =>
      row.academic_session_id === candidate.academic_session_id &&
      row.section_id === candidate.section_id &&
      row.subject_id === candidate.subject_id &&
      row.staff_id === candidate.staff_id,
  );
}

/** The periods an allocation with no override counts for: its class's curriculum row, or 0. */
function curriculumPeriods(curriculum: Curriculum[], allocation: Allocation): number {
  return (
    curriculum.find(
      (row) =>
        row.academic_session_id === allocation.academic_session_id &&
        row.class_id === allocation.class_id &&
        row.subject_id === allocation.subject_id,
    )?.weekly_periods ?? 0
  );
}

/**
 * The server's load summary: one row per teacher with a current allocation in the session,
 * by name. `allocations` counts every current row, but only a started one adds weekly periods
 * (`weekly_load_by_staff`'s window), so a teacher with just a future-dated row reads 0 periods.
 */
function loadSummary(rows: Allocation[], curriculum: Curriculum[], sessionId: string): LoadRow[] {
  const today = todayUtc();
  const byStaff = new Map<string, LoadRow>();
  for (const row of rows) {
    if (row.academic_session_id !== sessionId || row.effective_to !== null) continue;
    const entry = byStaff.get(row.staff_id) ?? {
      staff_id: row.staff_id,
      name: row.staff_name,
      weekly_periods: 0,
      allocations: 0,
      norm: WEEKLY_PERIOD_NORM,
      over_norm: false,
    };
    entry.allocations += 1;
    if (row.effective_from === null || row.effective_from <= today) {
      entry.weekly_periods += row.weekly_periods ?? curriculumPeriods(curriculum, row);
    }
    entry.over_norm = entry.weekly_periods > WEEKLY_PERIOD_NORM;
    byStaff.set(row.staff_id, entry);
  }
  return [...byStaff.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `current=true` is the rows with no end date, `false` the ended ones, absent both. */
function matchesCurrent(row: Allocation, current: string | null): boolean {
  return current === null || String(row.effective_to === null) === current;
}

/** The server's `search` (DRF `SearchFilter`): every whitespace-separated term must appear in
 * the teacher's name, the subject's name or the section's name. */
function matchesSearch(row: Allocation, search: string): boolean {
  const haystack = `${row.staff_name} ${row.subject_name} ${row.section_name}`.toLowerCase();
  return search.split(/\s+/).every((term) => haystack.includes(term));
}

/** The column behind an `?ordering=` field; `staff_last_name` is the teacher column's key,
 * which a row doesn't carry. */
function sortValue(row: Allocation, field: string): unknown {
  if (field === "staff_last_name") return row.staff_name.split(" ").at(-1);
  const columns: Record<string, unknown> = { ...row };
  return columns[field];
}

function filterAndOrder(rows: Allocation[], params: URLSearchParams): Allocation[] {
  const sessionId = params.get("academic_session_id");
  const classId = params.get("class_id");
  const sectionId = params.get("section_id");
  const subjectId = params.get("subject_id");
  const staffId = params.get("staff_id");
  const current = params.get("current");
  const search = params.get("search")?.toLowerCase();
  const ordering = params.get("ordering");

  const matching = rows.filter(
    (row) =>
      (!sessionId || row.academic_session_id === sessionId) &&
      (!classId || row.class_id === classId) &&
      (!sectionId || row.section_id === sectionId) &&
      (!subjectId || row.subject_id === subjectId) &&
      (!staffId || row.staff_id === staffId) &&
      matchesCurrent(row, current) &&
      (!search || matchesSearch(row, search)),
  );
  if (!ordering) return matching;
  const direction = ordering.startsWith("-") ? -1 : 1;
  const field = ordering.replace(/^-/, "");
  const compare = (a: Allocation, b: Allocation) =>
    direction * compareValues(sortValue(a, field), sortValue(b, field));
  return [...matching].sort(compare);
}
