import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, noContent, ok } from "../envelope";
import { compareValues, cursorPageOf, nameOf, pageOf, type Named } from "../list";
import type { MockModule } from "../router";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a status, a count, the default flag). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time. */
export type ExamStatus = ApiSchemas["ExamStatusEnum"];
export type Exam = Writable<ApiSchemas["Exam"]>;
export type ExamSubject = Writable<ApiSchemas["ExamSubject"]>;
export type GradeBand = Writable<ApiSchemas["GradeBand"]>;
export type GradingScale = Writable<ApiSchemas["GradingScale"]>;

const STAMP = "2026-04-01T00:00:00Z";

export function buildGradeBand(overrides: Partial<GradeBand> = {}): GradeBand {
  return {
    id: uuid(),
    grading_scale_id: "",
    label: "A",
    min_percent: "0.00",
    max_percent: "100.00",
    grade_point: null,
    is_passing: true,
    remark: null,
    sort_order: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** A scale with one band covering 0 to 100, so an exam may use it. */
export function buildGradingScale(overrides: Partial<GradingScale> = {}): GradingScale {
  const id = overrides.id ?? uuid();
  return {
    id,
    name: "Percentage",
    scale_type: "percentage",
    gpa_max: null,
    is_default: false,
    description: null,
    bands: [buildGradeBand({ grading_scale_id: id })],
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** A UUID id: the exam page's route accepts nothing else (`isUuid`). */
export function buildExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: uuid(),
    academic_session_id: "",
    academic_session_name: "2026-27",
    term_id: null,
    term_name: null,
    name: "Midterm 2026",
    exam_type: "midterm",
    grading_scale_id: "",
    grading_scale_name: "Percentage",
    weightage_percent: "100.00",
    starts_on: null,
    ends_on: null,
    status: "draft",
    subject_count: 0,
    description: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildExamSubject(overrides: Partial<ExamSubject> = {}): ExamSubject {
  return {
    id: uuid(),
    exam_id: "",
    exam_name: "Midterm 2026",
    class_id: "",
    class_name: "Grade 1",
    subject_id: "",
    subject_name: "Mathematics",
    max_marks: "100.00",
    pass_marks: "40.00",
    has_practical: false,
    practical_max_marks: null,
    practical_pass_marks: null,
    subject_weightage_percent: "100.00",
    marks_entry_opens_at: null,
    marks_entry_closes_at: null,
    marks_locked_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export interface ExamsSetupOptions {
  /** Held by reference: a spec that changes a stub's `status` mid-test models the exam moving on
   * on the server while the page still shows the old state. */
  exams?: Exam[];
  examSubjects?: ExamSubject[];
  gradingScales?: GradingScale[];
  /** The lists `schoolOrganizationModule` serves, for a written row's names. */
  sessions?: Named[];
  terms?: Named[];
  classes?: Named[];
  subjects?: Named[];
}

/** `services.CONFIGURABLE_STATUSES`: an exam's configuration changes up to `scheduled`. */
const CONFIGURABLE: readonly ExamStatus[] = ["draft", "scheduled"];

/** `ExamStatus`'s display label, lower-cased as the server's refusals print it. */
function statusLabel(status: ExamStatus): string {
  return status.replace("_", " ");
}

/** 409 for an exam past `scheduled`, in `services.assert_exam_is_configurable`'s words. */
function frozenResponse(exam: Exam) {
  if (CONFIGURABLE.includes(exam.status)) return undefined;
  return fail(
    409,
    `This exam is ${statusLabel(exam.status)} and its configuration is frozen. ` +
      "Marks have been entered against the current marks structure.",
  );
}

/** 409 for any exam but a draft, in `services.assert_exam_is_deletable`'s words. */
function undeletableResponse(exam: Exam) {
  if (exam.status === "draft") return undefined;
  return fail(409, `This exam is ${statusLabel(exam.status)}. Only a draft exam can be deleted.`);
}

/** 422 under `subject_id`, as `services.assert_exam_subject_is_unique` raises it. */
function duplicateSubjectResponse(rows: ExamSubject[], candidate: ExamSubject) {
  const clash = rows.some(
    (row) =>
      row.id !== candidate.id &&
      row.exam_id === candidate.exam_id &&
      row.class_id === candidate.class_id &&
      row.subject_id === candidate.subject_id,
  );
  if (!clash) return undefined;
  const issue = "This subject is already on this exam for this class.";
  return fail(422, issue, {
    code: "domain_rule_violation",
    details: [{ field: "subject_id", issue }],
  });
}

function ordered<T>(rows: T[], ordering: string): T[] {
  const keys = ordering.split(",").filter(Boolean);
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const direction = key.startsWith("-") ? -1 : 1;
      const field = key.replace(/^-/, "") as keyof T;
      const result = direction * compareValues(a[field], b[field]);
      if (result !== 0) return result;
    }
    return 0;
  });
}

/**
 * `/grading-scales` (with `/grade-bands` and `:set-default`), `/exams` and `/exam-subjects`, in
 * the shapes the server sends: page numbers on the two lists (api-architecture.md §2.4), a cursor
 * on the exam's subjects (class, then subject), and a scale's bands unpaginated.
 *
 * Mirrors the server's refusals the screens surface (lesson L5), in its words: a delete of any
 * exam past `draft` and a write to one past `scheduled` (or to its subjects) are 409s, and a
 * second (exam, class, subject) is a 422 under `subject_id`. An exam that names no scale takes
 * the default one. Whether a write is accepted at all is the live lane's to prove.
 */
export function examsSetupModule(options: ExamsSetupOptions = {}): MockModule {
  return (api) => {
    const exams = [...(options.exams ?? [])];
    const examSubjects = [...(options.examSubjects ?? [])];
    const scales = [...(options.gradingScales ?? [])];
    const sessions = options.sessions ?? [];
    const terms = options.terms ?? [];
    const classes = options.classes ?? [];
    const subjects = options.subjects ?? [];

    const findExam = (examId: string | undefined) => exams.find((row) => row.id === examId);
    const recount = (exam: Exam) => {
      exam.subject_count = examSubjects.filter((row) => row.exam_id === exam.id).length;
    };

    api.get("/grading-scales", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const scaleType = params.get("scale_type");
      const matching = scales.filter(
        (row) =>
          (!scaleType || row.scale_type === scaleType) &&
          (!search || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(search)),
      );
      return pageOf(ordered(matching, params.get("ordering") ?? "name"), params);
    });

    api.get("/grading-scales/:scaleId/grade-bands", (request) => {
      const scale = scales.find((row) => row.id === request.params["scaleId"]);
      return scale ? ok(scale.bands) : fail(404, "Not found.");
    });

    // `router.ts` reads `:name` as a param, so `/grading-scales/{id}:set-default` lands here
    // whole; no other POST shares the `/grading-scales/{segment}` shape.
    api.post("/grading-scales/:scaleAction", (request) => {
      const [scaleId, action] = (request.params["scaleAction"] ?? "").split(":");
      const scale = scales.find((row) => row.id === scaleId);
      if (action !== "set-default" || !scale) return fail(404, "Not found.");
      for (const row of scales) row.is_default = row.id === scale.id;
      return ok(scale);
    });

    api.get("/exams", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const sessionId = params.get("academic_session_id");
      const termId = params.get("term_id");
      const status = params.get("status");
      const examType = params.get("exam_type");
      const matching = exams.filter(
        (row) =>
          (!sessionId || row.academic_session_id === sessionId) &&
          (!termId || row.term_id === termId) &&
          (!status || row.status === status) &&
          (!examType || row.exam_type === examType) &&
          (!search || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(search)),
      );
      // `ExamViewSet.ordering`.
      return pageOf(ordered(matching, params.get("ordering") ?? "-starts_on,name,id"), params);
    });

    api.get("/exams/:examId", (request) => {
      const exam = findExam(request.params["examId"]);
      return exam ? ok(exam) : fail(404, "Not found.");
    });

    api.post("/exams", (request) => {
      const body = request.json() as Partial<Exam> | null;
      if (!body?.name?.trim() || !body.academic_session_id) {
        return fail(400, "Validation failed.", {
          details: [{ field: "name", issue: "This field is required." }],
        });
      }
      const scale = body.grading_scale_id
        ? scales.find((row) => row.id === body.grading_scale_id)
        : scales.find((row) => row.is_default);
      if (!scale) {
        const issue = "This tenant has no default grading scale, so an exam must name one.";
        return fail(400, issue, { details: [{ field: "grading_scale_id", issue }] });
      }
      const created = buildExam({
        ...body,
        // The server assigns the id, so a client-supplied one never wins.
        id: uuid(),
        academic_session_name: nameOf(sessions, body.academic_session_id) ?? "",
        term_name: nameOf(terms, body.term_id),
        grading_scale_id: scale.id,
        grading_scale_name: scale.name,
        status: "draft",
        subject_count: 0,
      });
      exams.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/exams/:examId", (request) => {
      const exam = findExam(request.params["examId"]);
      if (!exam) return fail(404, "Not found.");
      const refused = frozenResponse(exam);
      if (refused) return refused;
      Object.assign(exam, (request.json() as Partial<Exam> | null) ?? {}, {
        updated_at: "2026-09-02T00:00:00Z",
      });
      // The names follow whatever the body changed.
      exam.academic_session_name =
        nameOf(sessions, exam.academic_session_id) ?? exam.academic_session_name;
      exam.term_name = nameOf(terms, exam.term_id);
      exam.grading_scale_name =
        scales.find((row) => row.id === exam.grading_scale_id)?.name ?? exam.grading_scale_name;
      return ok(exam);
    });

    api.delete("/exams/:examId", (request) => {
      const index = exams.findIndex((row) => row.id === request.params["examId"]);
      const exam = exams[index];
      if (!exam) return fail(404, "Not found.");
      const refused = undeletableResponse(exam);
      if (refused) return refused;
      exams.splice(index, 1);
      // Its subjects go with it.
      for (let i = examSubjects.length - 1; i >= 0; i -= 1) {
        if (examSubjects[i]?.exam_id === exam.id) examSubjects.splice(i, 1);
      }
      return noContent();
    });

    api.get("/exam-subjects", (request) => {
      const params = request.searchParams;
      const examId = params.get("exam_id");
      const matching = examSubjects.filter((row) => !examId || row.exam_id === examId);
      // `ExamSubjectViewSet.ordering`: class, then subject.
      return cursorPageOf(ordered(matching, "class_name,subject_name"), params);
    });

    api.post("/exam-subjects", (request) => {
      const body = request.json() as Partial<ExamSubject> | null;
      const exam = findExam(body?.exam_id);
      if (!body || !exam) return fail(400, "Validation failed.");
      const refused = frozenResponse(exam);
      if (refused) return refused;
      const created = buildExamSubject({
        ...body,
        id: uuid(),
        exam_name: exam.name,
        class_name: nameOf(classes, body.class_id) ?? "",
        subject_name: nameOf(subjects, body.subject_id) ?? "",
      });
      const duplicate = duplicateSubjectResponse(examSubjects, created);
      if (duplicate) return duplicate;
      examSubjects.push(created);
      recount(exam);
      return ok(created, { status: 201 });
    });

    api.patch("/exam-subjects/:rowId", (request) => {
      const row = examSubjects.find((candidate) => candidate.id === request.params["rowId"]);
      const exam = findExam(row?.exam_id);
      if (!row || !exam) return fail(404, "Not found.");
      const refused = frozenResponse(exam);
      if (refused) return refused;
      Object.assign(row, (request.json() as Partial<ExamSubject> | null) ?? {}, {
        updated_at: "2026-09-02T00:00:00Z",
      });
      return ok(row);
    });

    api.delete("/exam-subjects/:rowId", (request) => {
      const index = examSubjects.findIndex((row) => row.id === request.params["rowId"]);
      const row = examSubjects[index];
      const exam = findExam(row?.exam_id);
      if (!row || !exam) return fail(404, "Not found.");
      const refused = frozenResponse(exam);
      if (refused) return refused;
      examSubjects.splice(index, 1);
      recount(exam);
      return noContent();
    });
  };
}
