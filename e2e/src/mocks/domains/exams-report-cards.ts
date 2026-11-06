import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, harnessError, ok, type MockResponse } from "../envelope";
import { cursorPageOf } from "../list";
import type { MockModule } from "../router";
import {
  EXAM_STATUS_DISPLAY,
  type ExamResult,
  type ExamsResultsState,
  RESULTS_ACTED_AT,
} from "./exams-results-state";
import type { Exam } from "./exams-setup";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a status, a stamp, a file). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time. */
export type ReportCard = Writable<ApiSchemas["ReportCard"]>;
type ResultRegisterRow = ApiSchemas["ResultRegisterReportRow"];

// The server's fixed `meta.message` on the generation `202`.
const GENERATE_MESSAGE = "Report card generation queued.";

/** `reports.result_register`'s order: rank in section, unranked last, then name. */
function byRank(a: ExamResult, b: ExamResult): number {
  const aRank = a.rank_in_section ?? Number.POSITIVE_INFINITY;
  const bRank = b.rank_in_section ?? Number.POSITIVE_INFINITY;
  return aRank - bRank || a.student_name.localeCompare(b.student_name);
}

function registerRow(result: ExamResult): ResultRegisterRow {
  const [first = "", ...rest] = result.student_name.split(" ");
  return {
    kind: "result-register",
    id: result.id,
    student_id: result.student_id,
    first_name: first,
    last_name: rest.join(" "),
    admission_number: result.admission_number,
    section_name: result.section_name,
    percentage: Number(result.percentage),
    total_obtained_marks: Number(result.total_obtained_marks),
    total_max_marks: Number(result.total_max_marks),
    grade: result.grade,
    gpa: result.gpa === null ? null : Number(result.gpa),
    rank_in_section: result.rank_in_section,
    rank_in_class: result.rank_in_class,
    outcome: result.outcome,
    status: result.status,
  };
}

/**
 * An exam's report cards and its result register, on the results `state` `examsResultsModule`
 * serves: `/exams/{id}:generate-report-cards` (with its job), `/report-cards` (list, `:download`),
 * and the result register of `/reports/exam-summary`.
 *
 * Mirrors the server's rules the screens surface (lesson L5): report cards come only from a
 * published exam (409), one per published result not withheld, each rendered with a file (a
 * published card is re-issued as a new version); `:download` is a 404 for a card without one.
 *
 * Owns `/report-cards`, `/report-cards/:cardAction` and `/reports/exam-summary`. It does **not**
 * register `POST /exams/:examAction` or `GET /jobs/:jobId`: `:generate-report-cards` goes into
 * `state.examActions` and its job into `state.jobs`, both served by `examsResultsModule`, so the
 * spec must register that module too (after `examsScheduleModule`, which also registers both
 * routes; a later stub wins). Whether the server really enforces any of this is the live lane's
 * (`tests/live/api/exams-results.spec.ts`).
 */
export function examsReportCardsModule(state: ExamsResultsState): MockModule {
  return (api) => {
    const cards: ReportCard[] = [];

    function generateReportCards(exam: Exam): MockResponse {
      if (exam.status !== "published") {
        return fail(
          409,
          `This exam is ${EXAM_STATUS_DISPLAY[exam.status]}. Report cards are generated ` +
            "from published results (§11).",
        );
      }
      const released = state
        .resultsOf(exam)
        .filter((row) => row.status === "published" && row.outcome !== "withheld");
      for (const result of released) {
        const current = cards.find((card) => card.result_id === result.id);
        if (current) {
          // A published card is re-issued as a new version; a draft is rendered in place.
          if (current.status === "published") current.version += 1;
          current.file_id = uuid();
          current.status = "generated";
          continue;
        }
        cards.push({
          id: uuid(),
          exam_id: exam.id,
          term_id: exam.term_id ?? uuid(),
          student_id: result.student_id,
          student_name: result.student_name,
          admission_number: result.admission_number,
          result_id: result.id,
          section_id: result.section_id,
          section_name: result.section_name,
          percentage: result.percentage,
          grade: result.grade,
          file_id: uuid(),
          class_teacher_remarks: null,
          principal_remarks: null,
          attendance_summary: null,
          version: 1,
          status: "generated",
          published_at: null,
          created_at: RESULTS_ACTED_AT,
          updated_at: RESULTS_ACTED_AT,
        });
      }
      const jobId = state.queueJob("exams.report-cards", {
        rendered: released.length,
        failed: [],
        cards: released.length,
      });
      return ok(
        { job_id: jobId, status: "queued" },
        { status: 202, meta: { message: GENERATE_MESSAGE } },
      );
    }

    state.examActions.set("generate-report-cards", (exam, request) =>
      state.once(request.headers["idempotency-key"], () => generateReportCards(exam)),
    );

    api.get("/report-cards", (request) => {
      const params = request.searchParams;
      const matching = cards.filter(
        (card) =>
          (!params.get("exam_id") || card.exam_id === params.get("exam_id")) &&
          (!params.get("section_id") || card.section_id === params.get("section_id")) &&
          (!params.get("status") || card.status === params.get("status")),
      );
      return cursorPageOf(matching, params);
    });

    // `/report-cards/{id}:download`, the same colon-action split.
    api.post("/report-cards/:cardAction", (request) => {
      const [cardId, action] = (request.params["cardAction"] ?? "").split(":");
      const card = cards.find((row) => row.id === cardId);
      if (action !== "download" || !card) return fail(404, "Not found.");
      if (card.file_id === null) {
        return fail(404, "This report card has no document to download.");
      }
      return ok({ download_url: reportCardUrl(card.id) });
    });

    // The one kind a spec drives: the result register, rank order, unranked last. Any other kind
    // is a harness error rather than an invented answer.
    api.get("/reports/exam-summary", (request) => {
      const params = request.searchParams;
      if (params.get("kind") !== "result-register") {
        return harnessError("examsReportCardsModule serves only the result register.");
      }
      const exam = state.findExam(params.get("exam_id") ?? undefined);
      if (!exam) return fail(404, "Not found.");
      return ok(state.resultsOf(exam).sort(byRank).map(registerRow));
    });
  };
}

/** The signed link `:download` answers with for a report card. */
export function reportCardUrl(cardId: string): string {
  return `https://storage.e2e.test/report-cards/${cardId}.pdf`;
}
