import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, noContent, ok, type MockResponse } from "../envelope";
import { compareValues, cursorPageOf, nameOf, pageOf, type Named } from "../list";
import type { MockModule } from "../router";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a count, an approval, a usage). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time. */
export type QuestionBank = Writable<ApiSchemas["QuestionBank"]>;
export type Question = Writable<ApiSchemas["Question"]>;
type PaperSection = ApiSchemas["PaperSection"];

const STAMP = "2026-10-01T00:00:00Z";
const ACTED_AT = "2026-11-02T00:00:00Z";

// The server's sentences, verbatim (`QuestionSerializer.validate`, `assert_question_is_approvable`,
// `QuestionBankViewSet.assemble_paper`), so a screen that shows them shows what users see (L5).
const REQUIRED = "This field is required.";
const NEEDS_OPTIONS =
  "A multiple-choice or true/false question needs its choices — without them a paper would " +
  "print a stem with nothing under it.";
const NOT_APPROVABLE =
  "Only AI-generated questions go through approval. A question a teacher wrote is usable as " +
  "soon as it is saved.";
const APPROVED_MESSAGE = "Question approved for use.";
const ASSEMBLY_QUEUED = "Paper assembly queued.";
const CHOICE_TYPES: readonly string[] = ["mcq", "true_false"];

export function buildQuestionBank(overrides: Partial<QuestionBank> = {}): QuestionBank {
  return {
    id: uuid(),
    subject_id: "",
    subject_name: "Mathematics",
    class_id: null,
    class_name: null,
    name: "Algebra basics",
    description: null,
    status: "active",
    question_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: uuid(),
    question_bank_id: "",
    question_text: "Solve 2x + 3 = 7.",
    question_type: "short_answer",
    difficulty: "easy",
    default_marks: "1.00",
    options: null,
    answer_key: null,
    topic: null,
    source: "manual",
    is_approved: true,
    approved_by: null,
    approved_by_name: null,
    usage_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** The signed link `POST /files/{id}:download` answers with for a paper. */
export function paperUrl(fileId: string): string {
  return `https://storage.e2e.test/papers/${fileId}.pdf`;
}

export interface QuestionBanksOptions {
  /** Held by reference, so a spec can read what a write left behind. */
  banks?: QuestionBank[];
  questions?: Question[];
  /** The lists `schoolOrganizationModule` serves, for a written bank's names. */
  subjects?: Named[];
  classes?: Named[];
  /** The viewer's record scope. Set, the viewer is an `assigned` teacher of these subjects: a bank
   * of any other subject is out of their scope (`QuestionBank.filter_assigned_to_user`). */
  assignedSubjectIds?: string[];
  /** The approver's name an `:approve` stamps (`approved_by_name`). */
  viewerName?: string;
}

interface Shortfall {
  index: number;
  difficulty: string;
  topic: string | null;
  requested: number;
  available: number;
}

/** 400 under each field, as the envelope handler builds it: `message` is the issue when there is
 * one, and the code's own name (`validation_error`) when there are several. */
function invalid(details: { field: string; issue: string }[]): MockResponse {
  const [first] = details;
  const message = details.length === 1 && first ? first.issue : "validation_error";
  return fail(400, message, { details });
}

/** A 422 `domain_rule_violation` carrying `error.meta`, as `DomainRuleViolation(meta=...)`. */
function withMeta(response: MockResponse, meta: Record<string, unknown>): MockResponse {
  const body = response.body as { error: Record<string, unknown> };
  return { ...response, body: { error: { ...body.error, meta } } };
}

/**
 * `/question-banks` (page numbers, ordered by name), a bank's `/questions` (a cursor, in
 * creation order), `:approve`, `:assemble-paper` and the paper job's `GET /jobs/{id}` and
 * `POST /files/{id}:download`, in the shapes the server sends.
 *
 * Mirrors the server's rules the screens surface (lesson L5), in its words:
 * - **record scope**: with `assignedSubjectIds`, the list holds only those subjects' banks, at
 *   any class, and every route on another bank is a 404 (`scoped_question_bank`);
 * - a choice question without choices is a 400 under `options`; an AI draft is saved unapproved
 *   whatever the body says, and `is_approved`, `approved_by` and `usage_count` are read-only;
 * - `:approve` on a manual question is a 409; on an AI draft it stamps the approver;
 * - `:assemble-paper` counts **approved** questions per section (by difficulty, or by difficulty
 *   and topic when one is named) and answers a 422 listing every short section in
 *   `error.meta.sections` before any job; otherwise a `202` whose job succeeds with
 *   `{result_file_id, questions, total_marks}`, each used question's `usage_count` raised.
 *
 * Owns `GET /jobs/:jobId` and `POST /files/:fileAction`, so a spec using it registers no
 * `jobsModule` (a later stub wins). Whether the server enforces any of this is the live lane's
 * (`tests/live/api/exams-question-banks.spec.ts`).
 */
export function examsQuestionBanksModule(options: QuestionBanksOptions = {}): MockModule {
  return (api) => {
    const banks = options.banks ?? [];
    const questions = options.questions ?? [];
    const subjects = options.subjects ?? [];
    const classes = options.classes ?? [];
    const scope = options.assignedSubjectIds;
    const jobs = new Map<string, Record<string, unknown>>();
    const files = new Set<string>();

    const inScope = (bank: QuestionBank) => !scope || scope.includes(bank.subject_id);
    const findBank = (bankId: string | undefined) =>
      banks.find((bank) => bank.id === bankId && inScope(bank));
    const questionsOf = (bank: QuestionBank) =>
      questions.filter((question) => question.question_bank_id === bank.id);
    const recount = (bank: QuestionBank) => {
      bank.question_count = questionsOf(bank).length;
    };

    api.get("/question-banks", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const matching = banks.filter(
        (bank) =>
          inScope(bank) &&
          (!params.get("subject_id") || bank.subject_id === params.get("subject_id")) &&
          (!params.get("status") || bank.status === params.get("status")) &&
          (!search || `${bank.name} ${bank.description ?? ""}`.toLowerCase().includes(search)),
      );
      const descending = params.get("ordering") === "-name" ? -1 : 1;
      // `ordering = ["name"]`, made total by the primary key.
      const ordered = [...matching].sort(
        (a, b) => descending * compareValues(a.name, b.name) || compareValues(a.id, b.id),
      );
      return pageOf(ordered, params);
    });

    api.post("/question-banks", (request) => {
      const body = (request.json() as Partial<QuestionBank> | null) ?? {};
      const missing = (["name", "subject_id"] as const).filter((field) => !body[field]);
      if (missing.length > 0) {
        return invalid(missing.map((field) => ({ field, issue: REQUIRED })));
      }
      const created = buildQuestionBank({
        ...body,
        id: uuid(),
        subject_name: nameOf(subjects, body.subject_id) ?? "",
        class_name: nameOf(classes, body.class_id),
        question_count: 0,
      });
      banks.push(created);
      return ok(created, { status: 201 });
    });

    api.get("/question-banks/:bankId", (request) => {
      const bank = findBank(request.params["bankId"]);
      return bank ? ok(bank) : fail(404, "Not found.");
    });

    api.patch("/question-banks/:bankId", (request) => {
      const bank = findBank(request.params["bankId"]);
      if (!bank) return fail(404, "Not found.");
      Object.assign(bank, (request.json() as Partial<QuestionBank> | null) ?? {}, {
        updated_at: ACTED_AT,
      });
      bank.subject_name = nameOf(subjects, bank.subject_id) ?? bank.subject_name;
      bank.class_name = nameOf(classes, bank.class_id);
      return ok(bank);
    });

    api.delete("/question-banks/:bankId", (request) => {
      const bank = findBank(request.params["bankId"]);
      if (!bank) return fail(404, "Not found.");
      banks.splice(banks.indexOf(bank), 1);
      return noContent();
    });

    function shortfallsOf(bank: QuestionBank, sections: PaperSection[]): Shortfall[] {
      const approved = questionsOf(bank).filter((question) => question.is_approved);
      return sections.flatMap((section, index) => {
        const topic = section.topic ?? null;
        const available = approved.filter(
          (question) =>
            question.difficulty === section.difficulty && (!topic || question.topic === topic),
        ).length;
        return available < section.count
          ? [{ index, difficulty: section.difficulty, topic, requested: section.count, available }]
          : [];
      });
    }

    /** `select_paper_questions`: least used first, never one question twice. */
    function assemble(bank: QuestionBank, sections: PaperSection[]) {
      const taken = new Set<string>();
      let totalMarks = 0;
      for (const section of sections) {
        const picked = questionsOf(bank)
          .filter(
            (question) =>
              question.is_approved &&
              !taken.has(question.id) &&
              question.difficulty === section.difficulty &&
              (!section.topic || question.topic === section.topic),
          )
          .sort((a, b) => a.usage_count - b.usage_count)
          .slice(0, section.count);
        for (const question of picked) {
          taken.add(question.id);
          question.usage_count += 1;
          totalMarks += Number(section.marks_each ?? question.default_marks ?? "1");
        }
      }
      return { questions: taken.size, totalMarks: totalMarks.toFixed(2) };
    }

    // `router.ts` reads `:name` as a param, so `/question-banks/{id}:assemble-paper` lands here
    // whole; no other POST shares the `/question-banks/{segment}` shape.
    api.post("/question-banks/:bankAction", (request) => {
      const [bankId, action] = (request.params["bankAction"] ?? "").split(":");
      const bank = findBank(bankId);
      if (action !== "assemble-paper" || !bank) return fail(404, "Not found.");
      const body = request.json() as { title?: string; sections?: PaperSection[] } | null;
      if (!body?.title) return invalid([{ field: "title", issue: REQUIRED }]);
      if (!body.sections || body.sections.length === 0) {
        return invalid([{ field: "sections", issue: "This list may not be empty." }]);
      }
      const shortfalls = shortfallsOf(bank, body.sections);
      if (shortfalls.length > 0) {
        const message =
          `${shortfalls.length} section(s) of this blueprint cannot be filled from the ` +
          "bank's approved questions.";
        return withMeta(
          fail(422, message, {
            code: "domain_rule_violation",
            details: [{ field: "non_field", issue: message }],
          }),
          { sections: shortfalls },
        );
      }
      const paper = assemble(bank, body.sections);
      const jobId = uuid();
      const fileId = uuid();
      files.add(fileId);
      jobs.set(jobId, {
        id: jobId,
        job_type: "exams.assemble-paper",
        status: "succeeded",
        progress: 100,
        result: {
          result_file_id: fileId,
          questions: paper.questions,
          total_marks: paper.totalMarks,
        },
        error: null,
      });
      return ok(
        { job_id: jobId, status: "queued" },
        { status: 202, meta: { message: ASSEMBLY_QUEUED } },
      );
    });

    api.get("/jobs/:jobId", (request) => {
      const job = jobs.get(request.params["jobId"] ?? "");
      return job ? ok(job) : fail(404, "Not found.");
    });

    api.post("/files/:fileAction", (request) => {
      const [fileId = "", action] = (request.params["fileAction"] ?? "").split(":");
      if (action !== "download" || !files.has(fileId)) return fail(404, "Not found.");
      return ok({ download_url: paperUrl(fileId) });
    });

    api.get("/question-banks/:bankId/questions", (request) => {
      const bank = findBank(request.params["bankId"]);
      if (!bank) return fail(404, "Not found.");
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const topic = params.get("topic")?.toLowerCase();
      const difficulty = params.get("difficulty");
      const type = params.get("question_type");
      const source = params.get("source");
      const approved = params.get("is_approved");
      const matching = questionsOf(bank).filter(
        (question) =>
          // `topic` is `iexact`; the rest are exact.
          (!topic || question.topic?.toLowerCase() === topic) &&
          (!difficulty || question.difficulty === difficulty) &&
          (!type || question.question_type === type) &&
          (!source || question.source === source) &&
          (approved === null || String(question.is_approved) === approved) &&
          (!search ||
            `${question.question_text} ${question.topic ?? ""}`.toLowerCase().includes(search)),
      );
      return cursorPageOf(matching, params);
    });

    api.post("/question-banks/:bankId/questions", (request) => {
      const bank = findBank(request.params["bankId"]);
      if (!bank) return fail(404, "Not found.");
      const body = (request.json() as Partial<Question> | null) ?? {};
      if (!body.question_text) return invalid([{ field: "question_text", issue: REQUIRED }]);
      if (CHOICE_TYPES.includes(body.question_type ?? "") && !body.options) {
        return invalid([{ field: "options", issue: NEEDS_OPTIONS }]);
      }
      const isDraft = body.source === "ai_generated";
      const created = buildQuestion({
        ...body,
        id: uuid(),
        question_bank_id: bank.id,
        // Read-only on the wire: an AI draft arrives unapproved whatever the body says.
        is_approved: !isDraft,
        approved_by: null,
        approved_by_name: null,
        usage_count: 0,
      });
      questions.push(created);
      recount(bank);
      return ok(created, { status: 201 });
    });

    api.patch("/question-banks/:bankId/questions/:questionId", (request) => {
      const bank = findBank(request.params["bankId"]);
      const questionId = request.params["questionId"];
      const question = bank && questionsOf(bank).find((row) => row.id === questionId);
      if (!question) return fail(404, "Not found.");
      const body = (request.json() as Partial<Question> | null) ?? {};
      const next = { ...question, ...body };
      if (CHOICE_TYPES.includes(next.question_type) && !next.options) {
        return invalid([{ field: "options", issue: NEEDS_OPTIONS }]);
      }
      Object.assign(question, body, {
        // The read-only fields keep the server's values.
        is_approved: question.is_approved,
        approved_by: question.approved_by,
        approved_by_name: question.approved_by_name,
        usage_count: question.usage_count,
        updated_at: ACTED_AT,
      });
      return ok(question);
    });

    api.delete("/question-banks/:bankId/questions/:questionId", (request) => {
      const bank = findBank(request.params["bankId"]);
      const index = questions.findIndex(
        (row) => row.id === request.params["questionId"] && row.question_bank_id === bank?.id,
      );
      if (!bank || index < 0) return fail(404, "Not found.");
      questions.splice(index, 1);
      recount(bank);
      return noContent();
    });

    // `/questions/{id}:approve`, the same colon-action split.
    api.post("/question-banks/:bankId/questions/:questionAction", (request) => {
      const bank = findBank(request.params["bankId"]);
      const [questionId, action] = (request.params["questionAction"] ?? "").split(":");
      const question = bank && questionsOf(bank).find((row) => row.id === questionId);
      if (action !== "approve" || !question) return fail(404, "Not found.");
      if (question.source !== "ai_generated") return fail(409, NOT_APPROVABLE);
      if (!question.is_approved) {
        question.is_approved = true;
        question.approved_by = uuid();
        question.approved_by_name = options.viewerName ?? "Ayesha Rahman";
        question.updated_at = ACTED_AT;
      }
      return ok(question, { meta: { message: APPROVED_MESSAGE } });
    });
  };
}
