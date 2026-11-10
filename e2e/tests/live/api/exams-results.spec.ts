import { randomUUID } from "node:crypto";
import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import {
  buildProcessedExam,
  createExamWithSubject,
  examStaffSession,
  type JobAccepted,
  liveExamTimeout,
  principalSession,
  processResults,
  publishExamForMarks,
  seedExamScaffold,
  teacherSession,
} from "@/lib/live-exams";
import { awaitJobResult } from "@/lib/live-jobs";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Examinations results and report cards (PR D), as one journey on a run-unique scaffold
 * (`buildProcessedExam`): the exam staff builds the exam and publishes its schedule, the
 * allocated `teacher` enters and submits the marks, and the exam staff locks and processes. The
 * principal sends the results back; the worker's admin (the school owner, who holds both the
 * process and the approve key) re-processes and is refused approval of their own run (§4, a 422
 * on `approved_by`); the principal, who did not run it, approves and publishes. The exam staff
 * then generates report cards, each of which gets a rendered file and a signed `:download` link.
 * A second test proves processing is refused (409 `marks_outstanding`) before any mark exists.
 *
 * **The student's view of published results stays in the Django suite** (`ResultViewSet`'s
 * restricted-principal narrowing, `views.py`): seeing it here would mean enrolling the seeded
 * student into a run-unique section, and parallel workers would race on that student's single
 * active enrolment.
 *
 * Report-card rendering needs WeasyPrint's system libraries in the API image (PR #151).
 *
 * Logins: one per identity per worker (e2e/AGENTS.md) — the admin (`liveApiClient`), and the
 * exam staff, teacher and principal sessions of `@/lib/live-exams`.
 *
 * Endpoints covered: `POST /exams/{id}:process-results` · `:send-results-back` ·
 * `:approve-results` · `:publish-results` · `:generate-report-cards`, `GET /results`,
 * `GET /report-cards`, `POST /report-cards/{id}:download`.
 */

interface ResultRow {
  student_id: string;
  status: string;
  outcome: string;
  processed_by: string | null;
  approved_by: string | null;
}

interface ReportCardRow {
  id: string;
  student_id: string;
  file_id: string | null;
  status: string;
}

interface RenderOutcome {
  rendered: number;
  failed: { student_id: string; error: string }[];
  cards: number;
}

async function refusal(request: Promise<unknown>): Promise<ApiError> {
  const outcome = await request.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

async function resultsOf(client: ApiClient, examId: string): Promise<ResultRow[]> {
  return (await client.get<ResultRow[]>("/results", { query: { exam_id: examId } })).data;
}

/** The one processor every result of the exam names: the latest run stamps them all (L57). */
async function processorOf(client: ApiClient, examId: string): Promise<string | null> {
  const processors = new Set((await resultsOf(client, examId)).map((row) => row.processed_by));
  expect(processors.size).toBe(1);
  return [...processors][0] ?? null;
}

test.describe("exam results and report cards", () => {
  test("runs from processing to report cards, barring the latest processor from approval", async ({
    liveApiClient,
  }) => {
    // Three polled jobs (process, re-process, report cards); `test.slow()`'s 90 s is no margin.
    test.setTimeout(liveExamTimeout(3));
    const staff = await examStaffSession();
    const principal = await principalSession();
    const { scaffold, exam, processed } = await buildProcessedExam(liveApiClient, {
      teacher: await teacherSession(),
    });
    const roster = scaffold.studentIds;

    // --- Processed by the exam staff: every student's result awaits approval. ---
    expect(processed).toEqual({ created: roster.length, updated: 0, students: roster.length });
    expect((await staff.get<{ status: string }>(`/exams/${exam.examId}`)).data.status).toBe(
      "processing",
    );
    const firstRun = await resultsOf(principal, exam.examId);
    expect(firstRun.map((row) => row.student_id).sort()).toEqual([...roster].sort());
    for (const row of firstRun) expect(row.status).toBe("pending_approval");
    // `submitSectionMarks` marks the first student absent.
    expect(firstRun.find((row) => row.student_id === roster[0])?.outcome).toBe("absent");
    const staffProcessor = await processorOf(principal, exam.examId);
    expect(staffProcessor).not.toBeNull();

    // --- The principal sends them back: marks entry reopens, the results leave the queue. ---
    const sentBack = await principal.post<{ reopened: number; reason: string }>(
      `/exams/${exam.examId}:send-results-back`,
      { reason: "Recheck the absentee." },
    );
    expect(sentBack.data).toEqual({ reopened: roster.length, reason: "Recheck the absentee." });
    expect((await staff.get<{ status: string }>(`/exams/${exam.examId}`)).data.status).toBe(
      "marks_entry",
    );
    for (const row of await resultsOf(principal, exam.examId)) {
      expect(row.status).toBe("processing");
    }

    // --- The owner re-processes: the run updates in place and re-stamps the processor. ---
    const rerun = await processResults(liveApiClient, exam.examId);
    expect(rerun).toEqual({ created: 0, updated: roster.length, students: roster.length });
    const ownerProcessor = await processorOf(principal, exam.examId);
    expect(ownerProcessor).not.toBeNull();
    expect(ownerProcessor).not.toBe(staffProcessor);

    // Holding the approve key is not enough: the latest processor may not approve (§4).
    const selfApproval = await refusal(liveApiClient.post(`/exams/${exam.examId}:approve-results`));
    expect(selfApproval.status).toBe(422);
    expect(selfApproval.details.map((detail) => detail.field)).toEqual(["approved_by"]);
    for (const row of await resultsOf(principal, exam.examId)) {
      expect(row.status).toBe("pending_approval");
    }

    // Publishing before approval is refused too.
    const early = await refusal(principal.post(`/exams/${exam.examId}:publish-results`));
    expect(early.status).toBe(409);

    // --- The principal, who ran neither processing, approves and publishes. ---
    const approved = await principal.post<{ approved: number }>(
      `/exams/${exam.examId}:approve-results`,
    );
    expect(approved.data).toEqual({ approved: roster.length });
    const published = await principal.post<{
      published: number;
      withheld: number;
      published_ids: string[];
    }>(`/exams/${exam.examId}:publish-results`);
    expect(published.data.published).toBe(roster.length);
    expect(published.data.withheld).toBe(0);
    expect(published.data.published_ids).toHaveLength(roster.length);
    const final = await resultsOf(principal, exam.examId);
    for (const row of final) {
      expect(row.status).toBe("published");
      expect(row.processed_by).toBe(ownerProcessor);
      expect(row.approved_by).not.toBeNull();
      expect(row.approved_by).not.toBe(ownerProcessor);
    }

    // --- The exam staff generates report cards: one rendered PDF per published result. ---
    const queued = await staff.post<JobAccepted>(
      `/exams/${exam.examId}:generate-report-cards`,
      undefined,
      { idempotencyKey: randomUUID() },
    );
    expect(queued.status).toBe(202);
    const rendered = await awaitJobResult<RenderOutcome>(staff, queued.data.job_id);
    expect(rendered).toEqual({ rendered: roster.length, failed: [], cards: roster.length });

    const cards = (
      await staff.get<ReportCardRow[]>("/report-cards", { query: { exam_id: exam.examId } })
    ).data;
    expect(cards.map((card) => card.student_id).sort()).toEqual([...roster].sort());
    for (const card of cards) {
      expect(card.file_id).not.toBeNull();
      expect(card.status).toBe("generated");
    }
    const [card] = cards;
    if (!card) throw new Error("expected a report card per student");
    const link = await staff.post<{ download_url: string }>(`/report-cards/${card.id}:download`);
    expect(link.data.download_url).toMatch(/^https?:\/\//);
  });

  test("processing is refused while marks are outstanding", async ({ liveApiClient }) => {
    const staff = await examStaffSession();
    const scaffold = await seedExamScaffold(liveApiClient);
    const exam = await createExamWithSubject(staff, scaffold);
    await publishExamForMarks(staff, scaffold, exam);

    const outstanding = await refusal(
      staff.post(`/exams/${exam.examId}:process-results`, undefined, {
        idempotencyKey: randomUUID(),
      }),
    );
    expect(outstanding.status).toBe(409);
    expect(outstanding.code).toBe("marks_outstanding");
    expect(outstanding.message).toContain(scaffold.subjectName);
    expect(outstanding.message).toContain(`${String(scaffold.studentIds.length)} student(s)`);
    expect((await staff.get<{ status: string }>(`/exams/${exam.examId}`)).data.status).toBe(
      "scheduled",
    );
  });
});
