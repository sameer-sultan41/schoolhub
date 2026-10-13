import { id, ORG_IDS, uuid } from "@/data/factories";
import { fail, noContent, ok, pagedList } from "../envelope";
import type { MockModule } from "../router";
import type { AcademicSession } from "./school-organization";

/** The generated `Curriculum` wire shape (a `class_subjects` row), trimmed to what the table
 * and its dialogs read. */
export interface Curriculum {
  id: string;
  academic_session_id: string;
  academic_session_name: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  campus_id: string | null;
  campus_name: string | null;
  is_elective: boolean;
  elective_group: string | null;
  weekly_periods: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function buildCurriculum(overrides: Partial<Curriculum> = {}): Curriculum {
  return {
    id: id("class-subject"),
    academic_session_id: ORG_IDS.currentSession,
    academic_session_name: "2026-27",
    class_id: ORG_IDS.grade1,
    class_name: "Grade 1",
    // A UUID: the edit form validates it on submit, though it never sends it.
    subject_id: uuid(),
    subject_name: "Mathematics",
    campus_id: null,
    campus_name: null,
    is_elective: false,
    elective_group: null,
    weekly_periods: 5,
    notes: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

/** Anything with an id and a name: the classes, subjects and campuses a created row's names
 * are looked up in. */
interface Named {
  id: string;
  name: string;
}

export interface AcademicsCurriculumOptions {
  rows?: Curriculum[];
  /** The sessions `schoolOrganizationModule` serves: the source of a created row's session
   * name, and of the closed-session lock the real API enforces on every write. */
  sessions?: AcademicSession[];
  /** The reference lists `schoolOrganizationModule` serves, for the names on a created row. */
  classes?: Named[];
  subjects?: Named[];
  campuses?: Named[];
}

interface CurriculumBody {
  academic_session_id: string;
  class_id: string;
  subject_id: string;
  campus_id?: string | null;
  is_elective?: boolean;
  elective_group?: string | null;
  weekly_periods?: number;
  notes?: string | null;
}

interface CloneBody {
  source_academic_session_id: string;
  target_academic_session_id: string;
}

/** Mirrors `LOCKED_SESSION_STATES` (`apps/api/apps/school_organization/services.py`). */
const LOCKED_STATUSES: readonly string[] = ["closed", "archived"];

/**
 * `/class-subjects` — the curriculum list, create, update and delete, plus the collection
 * colon-action `POST /class-subjects:clone` (a synchronous 200 with `{created, skipped}`).
 *
 * `GET /academic-sessions`, `/classes`, `/subjects` and `/campuses` stay in
 * `schoolOrganizationModule`; a spec passes the same lists to both.
 *
 * A spec opts in with `mockApi.use(academicsCurriculumModule({ rows, sessions }))`.
 */
export function academicsCurriculumModule(options: AcademicsCurriculumOptions = {}): MockModule {
  return (api) => {
    const rows = [...(options.rows ?? [])];
    const sessions = options.sessions ?? [];
    const classes = options.classes ?? [];
    const subjects = options.subjects ?? [];
    const campuses = options.campuses ?? [];

    // 422 for a write into a closed or archived session, as `assert_session_writable` does.
    const lockedResponse = (sessionId: string) => {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session || !LOCKED_STATUSES.includes(session.status)) return undefined;
      const message = `Academic session '${session.name}' is ${session.status} and cannot be modified.`;
      return fail(422, message, {
        code: "domain_rule_violation",
        details: [{ field: "non_field", issue: message }],
      });
    };

    api.get("/class-subjects", (request) => {
      const matching = filterAndOrder(rows, request.searchParams);
      const pageSize = Number(request.searchParams.get("page_size") ?? matching.length) || 1;
      const page = Number(request.searchParams.get("page") ?? 1) || 1;
      // DRF's `PageNumberPagination` answers a page past the last with 404 "Invalid page."
      // (an empty list still has page 1), and the list recovers from exactly that.
      if (page > Math.max(1, Math.ceil(matching.length / pageSize))) {
        return fail(404, "Invalid page.");
      }
      const start = (page - 1) * pageSize;
      return pagedList(matching.slice(start, start + pageSize), {
        page,
        page_size: pageSize,
        total_count: matching.length,
      });
    });

    api.post("/class-subjects", (request) => {
      const body = request.json() as CurriculumBody | null;
      if (!body) return fail(400, "Validation failed.");
      const locked = lockedResponse(body.academic_session_id);
      if (locked) return locked;

      // No `id` in the overrides: the server assigns it, so a client-supplied one never wins.
      const created = buildCurriculum({
        academic_session_id: body.academic_session_id,
        academic_session_name: nameOf(sessions, body.academic_session_id) ?? "",
        class_id: body.class_id,
        class_name: nameOf(classes, body.class_id) ?? "",
        subject_id: body.subject_id,
        subject_name: nameOf(subjects, body.subject_id) ?? "",
        campus_id: body.campus_id ?? null,
        campus_name: nameOf(campuses, body.campus_id),
        is_elective: body.is_elective ?? false,
        elective_group: body.elective_group ?? null,
        weekly_periods: body.weekly_periods ?? 1,
        notes: body.notes ?? null,
      });
      if (hasMapping(rows, created.academic_session_id, created)) {
        return fail(409, "That subject is already mapped to this class.");
      }
      rows.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/class-subjects/:rowId", (request) => {
      const match = rows.find((row) => row.id === request.params["rowId"]);
      if (!match) return fail(404, "Not found.");
      const locked = lockedResponse(match.academic_session_id);
      if (locked) return locked;
      Object.assign(match, (request.json() as Partial<Curriculum> | null) ?? {}, {
        updated_at: "2026-09-02T00:00:00Z",
      });
      return ok(match);
    });

    api.delete("/class-subjects/:rowId", (request) => {
      const index = rows.findIndex((row) => row.id === request.params["rowId"]);
      const match = rows[index];
      if (!match) return fail(404, "Not found.");
      const locked = lockedResponse(match.academic_session_id);
      if (locked) return locked;
      rows.splice(index, 1);
      return noContent();
    });

    // `router.ts` reads `:name` as a param, so this compiles to `^/class-subjects([^/]+)$` and
    // captures ":clone" whole, the same split `studentsModule`'s `/id-cards:cardAction` relies
    // on. It never meets `/class-subjects/{id}`: that path has a `/` right after the prefix.
    api.post("/class-subjects:collectionAction", (request) => {
      if (request.params["collectionAction"] !== ":clone") return fail(404, "Not found.");
      const body = request.json() as CloneBody | null;
      if (!body) return fail(400, "Validation failed.");
      const locked = lockedResponse(body.target_academic_session_id);
      if (locked) return locked;

      const targetName = nameOf(sessions, body.target_academic_session_id) ?? "";
      const sources = rows.filter(
        (row) => row.academic_session_id === body.source_academic_session_id,
      );
      let created = 0;
      let skipped = 0;
      for (const source of sources) {
        if (hasMapping(rows, body.target_academic_session_id, source)) {
          skipped += 1;
          continue;
        }
        rows.push({
          ...source,
          id: id("class-subject"),
          academic_session_id: body.target_academic_session_id,
          academic_session_name: targetName,
        });
        created += 1;
      }
      return ok({ created, skipped });
    });
  };
}

function nameOf(list: Named[], itemId: string | null | undefined): string | null {
  return list.find((item) => item.id === itemId)?.name ?? null;
}

/** Whether `sessionId` already maps `candidate`'s class and subject (and campus). */
function hasMapping(rows: Curriculum[], sessionId: string, candidate: Curriculum): boolean {
  return rows.some(
    (row) =>
      row.academic_session_id === sessionId &&
      row.class_id === candidate.class_id &&
      row.subject_id === candidate.subject_id &&
      row.campus_id === candidate.campus_id,
  );
}

function matchesSearch(row: Curriculum, search: string): boolean {
  return `${row.elective_group ?? ""} ${row.notes ?? ""}`.toLowerCase().includes(search);
}

function sortKey(value: unknown): number | string {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  return typeof value === "string" ? value : "";
}

function compareValues(a: unknown, b: unknown): number {
  const x = sortKey(a);
  const y = sortKey(b);
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).localeCompare(String(y));
}

function filterAndOrder(rows: Curriculum[], params: URLSearchParams): Curriculum[] {
  const sessionId = params.get("academic_session_id");
  const classId = params.get("class_id");
  const campusId = params.get("campus_id");
  const isElective = params.get("is_elective");
  const search = params.get("search")?.toLowerCase();
  const ordering = params.get("ordering");

  const matching = rows.filter(
    (row) =>
      (!sessionId || row.academic_session_id === sessionId) &&
      (!classId || row.class_id === classId) &&
      (!campusId || row.campus_id === campusId) &&
      (isElective === null || String(row.is_elective) === isElective) &&
      (!search || matchesSearch(row, search)),
  );
  if (!ordering) return matching;
  const direction = ordering.startsWith("-") ? -1 : 1;
  const field = ordering.replace(/^-/, "") as keyof Curriculum;
  return [...matching].sort((a, b) => direction * compareValues(a[field], b[field]));
}
