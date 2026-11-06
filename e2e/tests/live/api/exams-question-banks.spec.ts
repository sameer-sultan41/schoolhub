import { randomUUID } from "node:crypto";
import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import { buildLiveSubject } from "@/data/live-factories";
import { examStaffSession, type JobAccepted, liveExamTimeout } from "@/lib/live-exams";
import { awaitJobResult } from "@/lib/live-jobs";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Question banks and paper assembly (examinations dashboard PR E), on a run-unique subject: the
 * worker's admin adds the subject (the exam staff holds no subject write key); the seeded
 * `exam_staff` creates a bank for every level, writes its questions (and one AI draft, which is
 * saved unapproved whatever the body says), assembles a two-section paper whose job renders a
 * PDF (the job awaited, its file's signed link fetched), and has an over-asking blueprint refused
 * with a 422 naming **every** short section, the unapproved draft not counted.
 *
 * The paper render needs #151's WeasyPrint libraries in the API image (still open).
 *
 * Logins: the admin (`liveApiClient`) and the exam staff (`examStaffSession`), one per worker
 * each (e2e/AGENTS.md).
 *
 * Endpoints covered: `POST /question-banks`, `GET /question-banks/{id}`,
 * `POST /question-banks/{id}/questions`, `GET /question-banks/{id}/questions`,
 * `POST /question-banks/{id}:assemble-paper`, `GET /jobs/{id}`, `POST /files/{id}:download`.
 */

interface Identified {
  id: string;
}

interface BankRow {
  id: string;
  subject_id: string;
  subject_name: string;
  class_id: string | null;
  class_name: string | null;
  question_count: number;
}

interface QuestionRow {
  id: string;
  source: string;
  is_approved: boolean;
  approved_by: string | null;
}

/** The assembly job's `result` (`assemble_paper_task`). */
interface PaperResult {
  result_file_id: string;
  questions: number;
  total_marks: string;
}

interface Shortfall {
  index: number;
  difficulty: string;
  topic: string | null;
  requested: number;
  available: number;
}

const SECTION_MARKS = "5.00";

async function refusal(request: Promise<unknown>): Promise<ApiError> {
  const outcome = await request.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

/** A bank for every level of a fresh subject, written by `staff`; the subject by `admin`. */
async function createBank(admin: ApiClient, staff: ApiClient): Promise<BankRow> {
  const subjectPayload = buildLiveSubject();
  const subject = (await admin.post<Identified>("/subjects", subjectPayload)).data;
  const created = await staff.post<BankRow>("/question-banks", {
    name: `E2E Bank ${randomUUID().slice(0, 8)}`,
    subject_id: subject.id,
    class_id: null,
  });
  expect(created.status).toBe(201);
  expect(created.data).toMatchObject({
    subject_id: subject.id,
    subject_name: subjectPayload.name,
    class_id: null,
    class_name: null,
  });
  return created.data;
}

/**
 * Two easy short-answer questions on `topic`, two approved medium multiple-choice ones, and one
 * medium AI draft. Returns the draft as the server saved it.
 */
async function writeQuestions(
  staff: ApiClient,
  bankId: string,
  topic: string,
): Promise<QuestionRow> {
  const path = `/question-banks/${bankId}/questions`;
  for (const text of ["Solve 2x + 3 = 7.", "Solve 5x = 20."]) {
    await staff.post(path, {
      question_text: text,
      question_type: "short_answer",
      difficulty: "easy",
      default_marks: "1.00",
      topic,
      answer_key: "x",
    });
  }
  for (const text of ["Which is prime?", "Which is even?"]) {
    await staff.post(path, {
      question_text: text,
      question_type: "mcq",
      difficulty: "medium",
      default_marks: "2.00",
      options: ["4", "7"],
      answer_key: "7",
    });
  }
  const draft = await staff.post<QuestionRow>(path, {
    question_text: "Which is odd?",
    question_type: "mcq",
    difficulty: "medium",
    options: ["4", "9"],
    answer_key: "9",
    source: "ai_generated",
    // Read-only: an AI draft is saved unapproved whatever the body says (§7.2).
    is_approved: true,
  });
  return draft.data;
}

test.describe("question banks and paper assembly", () => {
  test("assembles a two-section paper from a bank's approved questions", async ({
    liveApiClient,
  }) => {
    // One polled job: the paper's render.
    test.setTimeout(liveExamTimeout(1));
    const staff = await examStaffSession();
    const bank = await createBank(liveApiClient, staff);
    const topic = `Equations ${randomUUID().slice(0, 8)}`;

    const draft = await writeQuestions(staff, bank.id, topic);
    expect(draft).toMatchObject({ source: "ai_generated", is_approved: false, approved_by: null });
    expect((await staff.get<BankRow>(`/question-banks/${bank.id}`)).data.question_count).toBe(5);
    const pending = await staff.get<QuestionRow[]>(`/question-banks/${bank.id}/questions`, {
      query: { is_approved: false },
    });
    expect(pending.data.map((question) => question.id)).toEqual([draft.id]);

    const accepted = await staff.post<JobAccepted>(`/question-banks/${bank.id}:assemble-paper`, {
      title: "E2E term test",
      sections: [
        { title: "Part A", difficulty: "easy", topic, count: 2 },
        { title: "Part B", difficulty: "medium", count: 2, marks_each: SECTION_MARKS },
      ],
    });
    expect(accepted.status).toBe(202);

    const paper = await awaitJobResult<PaperResult>(staff, accepted.data.job_id);
    // Two easy at their own 1.00, two medium at the section's 5.00.
    expect(paper).toMatchObject({ questions: 4, total_marks: "12.00" });
    const link = await staff.post<{ download_url: string }>(
      `/files/${paper.result_file_id}:download`,
    );
    expect(link.data.download_url).toMatch(/^https?:\/\//);
  });

  test("refuses an over-asking blueprint, naming every short section", async ({
    liveApiClient,
  }) => {
    const staff = await examStaffSession();
    const bank = await createBank(liveApiClient, staff);
    const topic = `Equations ${randomUUID().slice(0, 8)}`;
    await writeQuestions(staff, bank.id, topic);

    const refused = await refusal(
      staff.post(`/question-banks/${bank.id}:assemble-paper`, {
        title: "E2E over-asking test",
        sections: [
          { difficulty: "easy", topic, count: 2 },
          // Three medium asked for: two are approved, and the AI draft does not count.
          { difficulty: "medium", count: 3 },
          { difficulty: "hard", count: 1 },
        ],
      }),
    );

    expect(refused.status).toBe(422);
    expect(refused.code).toBe("domain_rule_violation");
    expect(refused.message).toBe(
      "2 section(s) of this blueprint cannot be filled from the bank's approved questions.",
    );
    const expected: Shortfall[] = [
      { index: 1, difficulty: "medium", topic: null, requested: 3, available: 2 },
      { index: 2, difficulty: "hard", topic: null, requested: 1, available: 0 },
    ];
    expect(refused.meta["sections"]).toEqual(expected);
  });
});
