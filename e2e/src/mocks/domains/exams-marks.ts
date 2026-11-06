import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, ok, type MockResponse } from "../envelope";
import type { MockModule } from "../router";
import type { Exam, ExamStatus, ExamSubject } from "./exams-setup";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a mark, a status, the lock). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time. */
export type MarksRow = Writable<ApiSchemas["Marks"]>;
export type MarksProgressRow = ApiSchemas["MarksProgressRow"];
type MarksGridEntry = ApiSchemas["MarksGridEntry"];
type MarksStatus = ApiSchemas["MarksStatusEnum"];

const STAMP = "2026-04-01T00:00:00Z";

/** A section of a class, as progress and the grid name it. */
export interface MarksSection {
  id: string;
  name: string;
  classId: string;
}

/** A student on a section's active roll in the exam's session (`services._entry_students`). */
export interface MarksRollStudent {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  rollNumber: string | null;
  sectionId: string;
}

/** An (exam-subject, section) pair the viewer may enter (`services.may_enter_marks`). */
export interface EnterablePair {
  examSubjectId: string;
  sectionId: string;
}

export function buildMarksRow(overrides: Partial<MarksRow> = {}): MarksRow {
  return {
    id: uuid(),
    exam_subject_id: "",
    student_id: "",
    theory_marks: null,
    practical_marks: null,
    is_absent: false,
    is_exempt: false,
    status: "draft",
    remarks: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export interface ExamsMarksOptions {
  /** The same objects `examsSetupModule` serves: a first save moves the exam to `marks_entry`,
   * and the exam page's own `GET /exams/{id}` then shows it. */
  exams: Exam[];
  /** The same objects too: a lock stamps `marks_locked_at` where the Subjects tab reads it. */
  examSubjects: ExamSubject[];
  sections: MarksSection[];
  roll: MarksRollStudent[];
  marks?: MarksRow[];
  /** The pairs the viewer may enter (an `assigned` teacher's allocations); omit for `all` scope. */
  enterable?: EnterablePair[];
  /** Whether the viewer holds `exams.marks.create`; a reader without it gets a read-only grid. */
  canEnter?: boolean;
}

/** `services.MARKS_WRITABLE_EXAM_STATUSES`. */
const MARKS_WRITABLE: readonly ExamStatus[] = ["scheduled", "ongoing", "marks_entry"];
/** The statuses a first save moves to `marks_entry`. */
const BEFORE_ENTRY: readonly ExamStatus[] = ["scheduled", "ongoing"];
const LOCKED_MESSAGE =
  "Marks for this subject are locked. They can only be changed after an unlock, which is audited.";
const NO_PERMISSION_MESSAGE = "You can read these marks but not enter them.";
const NOT_ALLOCATED =
  "You are not currently allocated to teach this subject to this section in the exam's " +
  "session, so you cannot enter its marks.";

/** A decimal as DRF quantizes and renders it (`decimal_places=2`). */
const decimal = (value: string) => Number(value).toFixed(2);

/** `%Y-%m-%d %H:%M` of an ISO timestamp, as the window refusals print it. */
const minute = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** `assert_exam_accepts_marks`' 409, or undefined. */
function examStatusRefusal(exam: Exam): string | undefined {
  if (MARKS_WRITABLE.includes(exam.status)) return undefined;
  return (
    `This exam is ${exam.status.replace("_", " ")}, so its marks are closed. ` +
    "Send the results back for correction to reopen entry."
  );
}

/** `assert_marks_window_open`'s three 409s, in its order: lock, not yet open, closed. */
function windowRefusal(subject: ExamSubject, now: string): [string, string] | undefined {
  if (subject.marks_locked_at !== null) return ["locked", LOCKED_MESSAGE];
  const opens = subject.marks_entry_opens_at;
  if (opens && now < opens) {
    return ["window_not_open", `Marks entry for this subject opens ${minute(opens)}.`];
  }
  const closes = subject.marks_entry_closes_at;
  if (closes && now > closes) {
    return [
      "window_closed",
      `Marks entry for this subject closed ${minute(closes)}. Ask for the window to be reopened.`,
    ];
  }
  return undefined;
}

/** `enrollment_roll_order`: shorter roll numbers first (they are text), unnumbered last, then
 * name, then id. */
function rollOrder(a: MarksRollStudent, b: MarksRollStudent): number {
  const aRoll = a.rollNumber;
  const bRoll = b.rollNumber;
  if ((aRoll === null) !== (bRoll === null)) return aRoll === null ? 1 : -1;
  return (
    (aRoll?.length ?? 0) - (bRoll?.length ?? 0) ||
    (aRoll ?? "").localeCompare(bRoll ?? "") ||
    a.studentName.localeCompare(b.studentName) ||
    a.studentId.localeCompare(b.studentId)
  );
}

interface EntryBody {
  student_id: string;
  theory_marks?: string | null;
  practical_marks?: string | null;
  is_absent?: boolean;
  is_exempt?: boolean;
  status?: MarksStatus;
  remarks?: string | null;
}

interface BulkEntryBody {
  exam_subject_id?: string;
  section_id?: string;
  entries?: EntryBody[];
}

/** `MarksEntrySerializer.validate`'s 400, flattened as `exceptions.py` does, or undefined. */
function serializerRefusal(entries: EntryBody[]): MockResponse | undefined {
  for (const [index, entry] of entries.entries()) {
    const hasMark = Boolean(entry.theory_marks) || Boolean(entry.practical_marks);
    const refusal: [string, string] | undefined =
      entry.is_absent && hasMark
        ? ["is_absent", "An absent student cannot also have a mark."]
        : entry.is_absent && entry.is_exempt
          ? ["is_exempt", "Absent and exempt are different claims; a row cannot assert both."]
          : undefined;
    if (refusal) {
      const [field, issue] = refusal;
      return fail(400, issue, { details: [{ field: `entries.${index}.${field}`, issue }] });
    }
  }
  return undefined;
}

/** A 422 `domain_rule_violation` carrying `error.meta`, as `DomainRuleViolation(meta=...)`. */
function withMeta(response: MockResponse, meta: Record<string, unknown>): MockResponse {
  const body = response.body as { error: Record<string, unknown> };
  return { ...response, body: { error: { ...body.error, meta } } };
}

/**
 * An exam's marks: `GET /exams/{id}/marks-progress`, `GET /marks/grid`, `POST /marks:bulk-entry`
 * and `/exam-subjects/{id}:lock-marks` · `:unlock-marks`.
 *
 * Mirrors the server's rules the Marks tab surfaces (lesson L5), in its words and its order:
 * - the **section gate**: progress lists only the pairs the viewer may enter, a grid outside them
 *   is a 404, and a submit for one is a 422 on `section_id`;
 * - the grid's `meta.writable` runs `bulk_enter_marks`' gates (no entry key, exam status, lock,
 *   window), so a locked subject's grid is **read-only** with the lock's sentence;
 * - a submit runs the serializer first (absent and exempt exclude each other and any mark, a
 *   400 under `entries.N.<field>`), then the 409 gates, then the section gate, then each row (on
 *   the section's roll, at most `max_marks`); any refused row refuses the **whole grid**, a 422
 *   whose `error.meta.rows` names each `{index, student_id, field, issue}`, nothing saved;
 * - an accepted submit upserts, moves a `scheduled`/`ongoing` exam to `marks_entry`, and replays
 *   its first answer for a repeated `Idempotency-Key`;
 * - a lock stamps every row `locked` and is idempotent; an unlock returns rows to `submitted`.
 *
 * Whether the server really enforces any of this is the live lane's
 * (`tests/live/api/exams-marks.spec.ts`).
 */
export function examsMarksModule(options: ExamsMarksOptions): MockModule {
  return (api) => {
    const { exams, examSubjects, sections, roll } = options;
    const marks = [...(options.marks ?? [])];
    const canEnter = options.canEnter ?? true;
    const replays = new Map<string, MockResponse>();
    const now = () => new Date().toISOString();

    const mayEnter = (examSubjectId: string, sectionId: string) =>
      options.enterable === undefined ||
      options.enterable.some(
        (pair) => pair.examSubjectId === examSubjectId && pair.sectionId === sectionId,
      );
    const rollOf = (sectionId: string) =>
      roll.filter((student) => student.sectionId === sectionId).sort(rollOrder);
    const markOf = (examSubjectId: string, studentId: string) =>
      marks.find((row) => row.exam_subject_id === examSubjectId && row.student_id === studentId);
    const subjectOf = (examSubjectId: string | null) =>
      examSubjects.find((row) => row.id === examSubjectId);
    const examOf = (subject: ExamSubject) => exams.find((row) => row.id === subject.exam_id);

    api.get("/exams/:examId/marks-progress", (request) => {
      const exam = exams.find((row) => row.id === request.params["examId"]);
      if (!exam) return fail(404, "Not found.");
      const subjects = examSubjects
        .filter((row) => row.exam_id === exam.id)
        .sort(
          (a, b) =>
            a.class_name.localeCompare(b.class_name) ||
            a.subject_name.localeCompare(b.subject_name),
        );
      const rows: MarksProgressRow[] = subjects.flatMap((subject) =>
        sections
          .filter((section) => section.classId === subject.class_id)
          .filter((section) => rollOf(section.id).length > 0 && mayEnter(subject.id, section.id))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .map((section) => {
            const written = rollOf(section.id)
              .map((student) => markOf(subject.id, student.studentId))
              .filter((row): row is MarksRow => row !== undefined);
            return {
              exam_subject_id: subject.id,
              subject_name: subject.subject_name,
              class_name: subject.class_name,
              section_id: section.id,
              section_name: section.name,
              expected: rollOf(section.id).length,
              entered: written.length,
              submitted: written.filter((row) => row.status !== "draft").length,
              is_locked: subject.marks_locked_at !== null,
            };
          }),
      );
      return ok(rows);
    });

    api.get("/marks/grid", (request) => {
      const params = request.searchParams;
      const subject = subjectOf(params.get("exam_subject_id"));
      const section = sections.find((row) => row.id === params.get("section_id"));
      const exam = subject && examOf(subject);
      if (!subject || !section || !exam) return fail(404, "Not found.");
      if (section.classId !== subject.class_id || !mayEnter(subject.id, section.id)) {
        return fail(404, "Not found.");
      }
      const data: MarksGridEntry[] = rollOf(section.id).map((student) => ({
        student_id: student.studentId,
        student_name: student.studentName,
        admission_number: student.admissionNumber,
        roll_number: student.rollNumber,
        marks: markOf(subject.id, student.studentId) ?? null,
      }));
      const statusMessage = examStatusRefusal(exam);
      const blocked: [string, string] | undefined = !canEnter
        ? ["no_permission", NO_PERMISSION_MESSAGE]
        : statusMessage
          ? ["exam_status", statusMessage]
          : windowRefusal(subject, now());
      return ok(data, {
        meta: {
          exam_subject: {
            max_marks: subject.max_marks,
            pass_marks: subject.pass_marks,
            has_practical: subject.has_practical,
            practical_max_marks: subject.practical_max_marks,
          },
          writable: blocked === undefined,
          unwritable_reason: blocked?.[0] ?? null,
          unwritable_message: blocked?.[1] ?? null,
        },
      });
    });

    api.post("/marks:bulk-entry", (request) => {
      const key = request.headers["idempotency-key"];
      const replay = key ? replays.get(key) : undefined;
      if (replay) return replay;

      const body = (request.json() as BulkEntryBody | null) ?? {};
      const subject = subjectOf(body.exam_subject_id ?? null);
      const section = sections.find((row) => row.id === body.section_id);
      const exam = subject && examOf(subject);
      const entries = body.entries ?? [];
      const missing = (["section_id", "exam_subject_id", "entries"] as const)
        .filter((field) => body[field] === undefined)
        .map((field) => ({ field, issue: "This field is required." }));
      if (missing.length > 0) return fail(400, "Validation failed.", { details: missing });
      if (!subject || !section || !exam || entries.length === 0) {
        return fail(400, "Validation failed.");
      }
      const invalid = serializerRefusal(entries);
      if (invalid) return invalid;

      const statusMessage = examStatusRefusal(exam);
      if (statusMessage) return fail(409, statusMessage);
      const closed = windowRefusal(subject, now());
      if (closed) return fail(409, closed[1]);
      const sectionIssue =
        section.classId !== subject.class_id
          ? "This section is not in the class this exam-subject covers."
          : mayEnter(subject.id, section.id)
            ? undefined
            : NOT_ALLOCATED;
      if (sectionIssue) {
        return fail(422, sectionIssue, {
          code: "domain_rule_violation",
          details: [{ field: "section_id", issue: sectionIssue }],
        });
      }

      const eligible = new Set(rollOf(section.id).map((student) => student.studentId));
      const rejected = entries.flatMap((entry, index) => {
        const row = { index, student_id: entry.student_id };
        if (!eligible.has(entry.student_id)) {
          const issue = "This student is not on this section's roll for the exam's session.";
          return [{ ...row, field: "student_id", issue }];
        }
        const theory = entry.theory_marks ?? null;
        if (theory !== null && Number(theory) > Number(subject.max_marks)) {
          const max = subject.max_marks;
          const issue = `${decimal(theory)} is above this subject's maximum of ${max}.`;
          return [{ ...row, field: "theory_marks", issue }];
        }
        const practical = entry.practical_marks ?? null;
        if (practical === null) return [];
        if (!subject.has_practical) {
          const issue = "This subject has no practical component.";
          return [{ ...row, field: "practical_marks", issue }];
        }
        const practicalMax = subject.practical_max_marks;
        if (practicalMax !== null && Number(practical) > Number(practicalMax)) {
          const over = `${decimal(practical)} is above this subject's`;
          const issue = `${over} practical maximum of ${practicalMax}.`;
          return [{ ...row, field: "practical_marks", issue }];
        }
        return [];
      });
      if (rejected.length > 0) {
        const counts = `${rejected.length} of ${entries.length}`;
        const message = `${counts} rows were rejected; nothing was saved.`;
        const refused = fail(422, message, {
          code: "domain_rule_violation",
          details: [{ field: "non_field", issue: message }],
        });
        return withMeta(refused, { rows: rejected });
      }

      let entered = 0;
      let updated = 0;
      for (const entry of entries) {
        const values = {
          theory_marks: entry.theory_marks ? decimal(entry.theory_marks) : null,
          practical_marks: entry.practical_marks ? decimal(entry.practical_marks) : null,
          is_absent: entry.is_absent ?? false,
          is_exempt: entry.is_exempt ?? false,
          status: entry.status ?? "draft",
          remarks: entry.remarks ?? null,
          updated_at: "2026-09-02T00:00:00Z",
        };
        const existing = markOf(subject.id, entry.student_id);
        if (existing) {
          Object.assign(existing, values);
          updated += 1;
        } else {
          marks.push(
            buildMarksRow({ exam_subject_id: subject.id, student_id: entry.student_id, ...values }),
          );
          entered += 1;
        }
      }
      if (BEFORE_ENTRY.includes(exam.status)) exam.status = "marks_entry";

      const answer = ok(
        { entered, updated, rows: entries.length },
        { meta: { message: `${String(entered)} entered, ${String(updated)} updated.` } },
      );
      if (key) replays.set(key, answer);
      return answer;
    });

    // `router.ts` reads `:name` as a param, so `/exam-subjects/{id}:lock-marks` and
    // `:unlock-marks` both land here whole.
    api.post("/exam-subjects/:subjectAction", (request) => {
      const [subjectId, action] = (request.params["subjectAction"] ?? "").split(":");
      const subject = subjectOf(subjectId ?? null);
      const exam = subject && examOf(subject);
      if (!subject || !exam) return fail(404, "Not found.");
      const rowsOf = () => marks.filter((row) => row.exam_subject_id === subject.id);

      if (action === "lock-marks") {
        if (subject.marks_locked_at !== null) {
          return ok(
            { locked_rows: 0, already_locked: true },
            { meta: { message: "Marks were already locked." } },
          );
        }
        const rows = rowsOf();
        for (const row of rows) row.status = "locked";
        subject.marks_locked_at = "2026-09-02T00:00:00Z";
        return ok(
          { locked_rows: rows.length, already_locked: false },
          { meta: { message: `${String(rows.length)} row(s) locked.` } },
        );
      }

      if (action === "unlock-marks") {
        const statusMessage = examStatusRefusal(exam);
        if (statusMessage) return fail(409, statusMessage);
        if (subject.marks_locked_at === null) {
          return ok(
            { unlocked_rows: 0, already_unlocked: true },
            { meta: { message: "Marks were not locked." } },
          );
        }
        const rows = rowsOf().filter((row) => row.status === "locked");
        for (const row of rows) row.status = "submitted";
        subject.marks_locked_at = null;
        return ok(
          { unlocked_rows: rows.length, already_unlocked: false },
          { meta: { message: `${String(rows.length)} row(s) reopened.` } },
        );
      }

      return fail(404, "Not found.");
    });
  };
}
