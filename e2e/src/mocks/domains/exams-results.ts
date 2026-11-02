import { uuid } from "@/data/factories";
import { fail, ok, type MockResponse } from "../envelope";
import { cursorPageOf } from "../list";
import type { MockModule } from "../router";
import {
  EXAM_STATUS_DISPLAY,
  type ExamResult,
  type ExamsResultsState,
  RESULTS_ACTED_AT,
} from "./exams-results-state";
import type { Exam, ExamStatus } from "./exams-setup";

const STAMP = "2026-04-01T00:00:00Z";
// The server's fixed `meta.message` on the processing `202`.
const PROCESS_MESSAGE = "Result processing queued.";

export function buildResult(overrides: Partial<ExamResult> = {}): ExamResult {
  return {
    id: uuid(),
    exam_id: "",
    student_id: uuid(),
    student_name: "Ali Raza",
    admission_number: "ADM-001",
    section_id: "",
    section_name: "A",
    total_max_marks: "100.00",
    total_obtained_marks: "78.00",
    percentage: "78.00",
    grade: "A",
    gpa: null,
    rank_in_section: 1,
    rank_in_class: 1,
    outcome: "pass",
    grace_marks: "0.00",
    status: "pending_approval",
    processed_by: null,
    processed_by_name: null,
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    published_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** `services.RECOMPUTABLE_EXAM_STATUSES`. */
const RECOMPUTABLE: readonly ExamStatus[] = ["scheduled", "ongoing", "marks_entry", "processing"];
const PROCESSOR_MAY_NOT_APPROVE =
  "You ran the processing for this exam, so you cannot also approve it. Results need a second " +
  "pair of eyes (§4).";

/** `fail(400)` for a missing or blank `reason`, as DRF's `CharField` says it. */
function reasonRefusal(body: unknown): MockResponse | undefined {
  const reason = (body as { reason?: string } | null)?.reason;
  if (reason === undefined) {
    return fail(400, "This field is required.", {
      details: [{ field: "reason", issue: "This field is required." }],
    });
  }
  if (reason.trim() === "") {
    return fail(400, "This field may not be blank.", {
      details: [{ field: "reason", issue: "This field may not be blank." }],
    });
  }
  return undefined;
}

/** `ResultViewSet.ordering_fields`' one use: highest percentage first, then id (L29). */
function byPercentage(a: ExamResult, b: ExamResult): number {
  return Number(b.percentage) - Number(a.percentage) || a.id.localeCompare(b.id);
}

/**
 * An exam's results: `/exams/{id}:process-results` (with its job), `:approve-results`,
 * `:send-results-back`, `:publish-results`, and `/results` (list, `:withhold`). Report cards and
 * the result register are `examsReportCardsModule`'s, on the same `state`.
 *
 * Mirrors the server's rules the screens surface (lesson L5), in its words and its order:
 * - processing runs only before approval (409), and is refused while marks are outstanding (409,
 *   `marks_outstanding`, naming the subjects); a run upserts every computed row as
 *   `pending_approval`, **keeps a withheld result withheld**, stamps the viewer as `processed_by`
 *   on every pending row (L37), moves the exam to `processing`, and replays its first answer for
 *   a repeated `Idempotency-Key`;
 * - approval needs a `processing` exam with pending rows (409s), and **refuses the latest
 *   processor** (422 under `approved_by`); it approves a withheld row too, which stays withheld;
 * - a send-back needs a reason and a processed or approved exam, reopens every unpublished row,
 *   clears the approval and returns the exam to `marks_entry`;
 * - publishing needs an approved exam (**approve before publish**, 409), releases the approved
 *   rows that are not withheld and counts the withheld ones;
 * - a withhold needs a reason and refuses a published result (409).
 *
 * Owns `POST /exams/:examAction` and `GET /jobs/:jobId`, and dispatches an action it does not
 * know to `state.examActions` (where `examsReportCardsModule` puts `generate-report-cards`), so
 * each route has one owner. The router has no fallthrough and a later stub wins, so register
 * this module **after** `examsScheduleModule` (whose section list the Results and Report cards
 * filters read, and which registers both routes too) and do not drive that module's actions in
 * the same test. Whether the server really enforces any of this is the live lane's
 * (`tests/live/api/exams-results.spec.ts`).
 */
export function examsResultsModule(state: ExamsResultsState): MockModule {
  return (api) => {
    const { computed, viewer, results, findExam, resultsOf, queueJob, once } = state;

    function processResults(exam: Exam): MockResponse {
      if (!RECOMPUTABLE.includes(exam.status)) {
        return fail(
          409,
          `This exam is ${EXAM_STATUS_DISPLAY[exam.status]}. Results can only be reprocessed ` +
            "before approval — send them back for correction first.",
        );
      }
      const { outstanding } = state;
      if (outstanding.length > 0) {
        const named = [...outstanding].sort().join("; ");
        return fail(409, `Marks are still outstanding, so results cannot be processed: ${named}.`, {
          code: "marks_outstanding",
        });
      }

      let created = 0;
      let updated = 0;
      for (const row of computed) {
        const current = resultsOf(exam).find((result) => result.student_id === row.student_id);
        const withheld = current?.outcome === "withheld";
        const values = {
          ...row,
          outcome: withheld ? ("withheld" as const) : row.outcome,
          status: "pending_approval" as const,
          updated_at: RESULTS_ACTED_AT,
        };
        if (current) {
          Object.assign(current, values);
          updated += 1;
        } else {
          results.push(buildResult({ exam_id: exam.id, ...values }));
          created += 1;
        }
      }
      for (const row of resultsOf(exam).filter((result) => result.status === "pending_approval")) {
        row.processed_by = viewer.id;
        row.processed_by_name = viewer.fullName;
      }
      exam.status = "processing";

      const jobId = queueJob("exams.process-results", {
        created,
        updated,
        students: computed.length,
      });
      return ok(
        { job_id: jobId, status: "queued" },
        { status: 202, meta: { message: PROCESS_MESSAGE } },
      );
    }

    function approveResults(exam: Exam): MockResponse {
      if (exam.status !== "processing") {
        return fail(
          409,
          `This exam is ${EXAM_STATUS_DISPLAY[exam.status]}. ` +
            "Only processed results can be approved.",
        );
      }
      const pending = resultsOf(exam).filter((row) => row.status === "pending_approval");
      if (pending.length === 0) {
        return fail(409, "There are no processed results awaiting approval on this exam.");
      }
      if (pending.some((row) => row.processed_by === viewer.id)) {
        return fail(422, PROCESSOR_MAY_NOT_APPROVE, {
          code: "domain_rule_violation",
          details: [{ field: "approved_by", issue: PROCESSOR_MAY_NOT_APPROVE }],
        });
      }
      for (const row of pending) {
        row.status = "approved";
        row.approved_by = viewer.id;
        row.approved_by_name = viewer.fullName;
        row.approved_at = RESULTS_ACTED_AT;
      }
      exam.status = "approved";
      return ok(
        { approved: pending.length },
        { meta: { message: `${String(pending.length)} result(s) approved.` } },
      );
    }

    function sendResultsBack(exam: Exam, body: unknown): MockResponse {
      const invalid = reasonRefusal(body);
      if (invalid) return invalid;
      if (exam.status !== "processing" && exam.status !== "approved") {
        return fail(
          409,
          `This exam is ${EXAM_STATUS_DISPLAY[exam.status]}, so there are no results to send back.`,
        );
      }
      const reopened = resultsOf(exam).filter((row) => row.status !== "published");
      for (const row of reopened) {
        row.status = "processing";
        row.approved_by = null;
        row.approved_by_name = null;
        row.approved_at = null;
      }
      exam.status = "marks_entry";
      const reason = (body as { reason: string }).reason;
      return ok(
        { reopened: reopened.length, reason },
        {
          meta: {
            message: `${String(reopened.length)} result(s) reopened; marks entry is open again.`,
          },
        },
      );
    }

    function publishResults(exam: Exam): MockResponse {
      if (exam.status !== "approved" && exam.status !== "published") {
        return fail(
          409,
          `This exam is ${EXAM_STATUS_DISPLAY[exam.status]}. ` +
            "Only approved results can be published.",
        );
      }
      const publishable = resultsOf(exam).filter(
        (row) => row.status === "approved" && row.outcome !== "withheld",
      );
      const withheld = resultsOf(exam).filter((row) => row.outcome === "withheld").length;
      for (const row of publishable) {
        row.status = "published";
        row.published_at = RESULTS_ACTED_AT;
      }
      exam.status = "published";
      const published = publishable.length;
      return ok(
        { published, withheld, published_ids: publishable.map((row) => row.id) },
        {
          meta: {
            message:
              `${String(published)} result(s) published` +
              (withheld ? `; ${String(withheld)} withheld.` : "."),
          },
        },
      );
    }

    // `router.ts` reads `:name` as a param, so every `/exams/{id}:<action>` lands here whole.
    api.post("/exams/:examAction", (request) => {
      const [examId, action = ""] = (request.params["examAction"] ?? "").split(":");
      const exam = findExam(examId);
      if (!exam) return fail(404, "Not found.");
      const key = request.headers["idempotency-key"];

      switch (action) {
        case "process-results":
          return once(key, () => processResults(exam));
        case "approve-results":
          return approveResults(exam);
        case "send-results-back":
          return sendResultsBack(exam, request.json());
        case "publish-results":
          return publishResults(exam);
        default: {
          const handler = state.examActions.get(action);
          return handler ? handler(exam, request) : fail(404, "Not found.");
        }
      }
    });

    api.get("/jobs/:jobId", (request) => {
      const jobId = request.params["jobId"] ?? "";
      const job = state.jobs.get(jobId);
      if (!job) return fail(404, "Job not found.");
      return ok({
        id: jobId,
        job_type: job.jobType,
        status: "succeeded",
        progress: 100,
        result: job.result,
        error: null,
      });
    });

    api.get("/results", (request) => {
      const params = request.searchParams;
      const filters = ["exam_id", "section_id", "outcome", "status"] as const;
      const matches = (row: ExamResult) =>
        filters.every((field) => !params.get(field) || row[field] === params.get(field));
      const matching = results.filter(matches).sort(byPercentage);
      return cursorPageOf(matching, params);
    });

    // `/results/{id}:withhold`, the same colon-action split.
    api.post("/results/:resultAction", (request) => {
      const [resultId, action] = (request.params["resultAction"] ?? "").split(":");
      const result = results.find((row) => row.id === resultId);
      if (action !== "withhold" || !result) return fail(404, "Not found.");
      const invalid = reasonRefusal(request.json());
      if (invalid) return invalid;
      if (result.status === "published") {
        return fail(
          409,
          "This result is already published, so it cannot be withheld. Reprocess the exam to " +
            "correct it.",
        );
      }
      result.outcome = "withheld";
      return ok(result, { meta: { message: "Result withheld from publication." } });
    });
  };
}
