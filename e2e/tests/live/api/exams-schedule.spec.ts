import { randomUUID } from "node:crypto";
import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import {
  addExamSubject,
  createExamWithSubject,
  examStaffSession,
  firstExamDay,
  seedExamScaffold,
} from "@/lib/live-exams";
import { awaitJobResult } from "@/lib/live-jobs";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Examinations schedule and admit cards (PR B), as one exam-staff journey on a run-unique
 * scaffold (`@/lib/live-exams`): two papers of one section at the same time clash, the clash
 * holds a publish (422, every finding in `error.meta.conflicts`), moving one clears it, the
 * schedule publishes, cards are issued (the `202`'s counts, then the render job awaited), a card
 * lists with its section and a file, `:download` signs a link, and a revoke withdraws it for
 * good: no link, and a second issue run does not bring it back. The worker's admin builds the
 * scaffold; the seeded `exam_staff` does everything else, so its real keys are what run.
 *
 * Endpoints covered: `POST/PATCH /exam-schedules`, `GET /exams/{id}/schedule-conflicts`,
 * `POST /exams/{id}:publish-schedule`, `POST /exams/{id}:issue-admit-cards`, `GET /jobs/{id}`,
 * `GET /admit-cards`, `POST /admit-cards/{id}:download`, `POST /admit-cards/{id}:revoke`.
 */

interface Sitting {
  id: string;
  section_id: string;
  start_time: string;
}

interface Conflict {
  type: string;
  severity: string;
  schedule_ids: string[];
  message: string;
}

interface AdmitCard {
  id: string;
  exam_id: string;
  student_id: string;
  student_name: string;
  admission_number: string;
  section_id: string | null;
  section_name: string | null;
  admit_card_no: string;
  file_id: string | null;
  status: string;
  revoked_reason: string | null;
}

interface IssueAccepted {
  job_id: string;
  status: string;
  added: number;
  existing: number;
}

interface RenderResult {
  rendered: number;
  failed: unknown[];
  cards: number;
}

const STUDENT_CLASH = "student_two_papers_at_once";
const REVOKE_REASON = "Fees outstanding";

async function refusal(request: Promise<unknown>): Promise<ApiError> {
  const outcome = await request.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

function hardFindings(conflicts: readonly Conflict[]): Conflict[] {
  return conflicts.filter((finding) => finding.severity === "hard");
}

/** `:issue-admit-cards` with a fresh `Idempotency-Key`: the job and the server's typed counts. */
async function issueCards(client: ApiClient, examId: string) {
  const accepted = await client.post<IssueAccepted>(
    `/exams/${examId}:issue-admit-cards`,
    undefined,
    { idempotencyKey: randomUUID() },
  );
  expect(accepted.status).toBe(202);
  return {
    jobId: accepted.data.job_id,
    added: accepted.data.added,
    existing: accepted.data.existing,
  };
}

async function cardsOf(client: ApiClient, examId: string): Promise<AdmitCard[]> {
  return (await client.get<AdmitCard[]>("/admit-cards", { query: { exam_id: examId } })).data;
}

test.describe("exam schedule and admit cards", () => {
  test("a clash holds the publish until it is moved; cards issue, download and revoke", async ({
    liveApiClient,
  }) => {
    const staff = await examStaffSession();
    const scaffold = await seedExamScaffold(liveApiClient);
    const exam = await createExamWithSubject(staff, scaffold);
    const secondPaper = await addExamSubject(liveApiClient, staff, scaffold, exam.examId);
    const examDate = firstExamDay(scaffold);
    const roster = scaffold.studentIds.length;

    // A draft exam issues no cards: there is no published schedule to print.
    const tooEarly = await refusal(issueCards(staff, exam.examId));
    expect(tooEarly.status).toBe(409);

    // Two papers for the one section at 09:00: its students would sit both at once.
    const first = await staff.post<Sitting>("/exam-schedules", {
      exam_subject_id: exam.examSubjectId,
      section_id: scaffold.sectionId,
      exam_date: examDate,
      start_time: "09:00",
      end_time: "11:00",
    });
    const second = await staff.post<Sitting>("/exam-schedules", {
      exam_subject_id: secondPaper,
      section_id: scaffold.sectionId,
      exam_date: examDate,
      start_time: "09:00",
      end_time: "11:00",
    });
    const writeFindings = (second.meta?.["conflicts"] ?? []) as Conflict[];
    expect(writeFindings.map((finding) => finding.type)).toContain(STUDENT_CLASH);

    const listed = await staff.get<Conflict[]>(`/exams/${exam.examId}/schedule-conflicts`);
    const clash = listed.data.find((finding) => finding.type === STUDENT_CLASH);
    expect(clash?.severity).toBe("hard");
    expect(clash?.schedule_ids).toEqual(expect.arrayContaining([first.data.id, second.data.id]));

    // The publish is refused with every finding in `error.meta.conflicts`, not flattened.
    const blocked = await refusal(staff.post(`/exams/${exam.examId}:publish-schedule`));
    expect(blocked.status).toBe(422);
    const refused = (blocked.meta["conflicts"] ?? []) as Conflict[];
    expect(refused.map((finding) => finding.type)).toContain(STUDENT_CLASH);

    // Move the second paper to the afternoon: nothing hard remains.
    const moved = await staff.patch<Sitting>(`/exam-schedules/${second.data.id}`, {
      start_time: "13:00",
      end_time: "15:00",
    });
    expect(moved.data.start_time).toBe("13:00:00");
    expect(hardFindings((moved.meta?.["conflicts"] ?? []) as Conflict[])).toEqual([]);

    const published = await staff.post<{ status: string; conflicts: Conflict[] }>(
      `/exams/${exam.examId}:publish-schedule`,
    );
    expect(published.data.status).toBe("scheduled");
    expect(hardFindings(published.data.conflicts)).toEqual([]);

    // Issue: the rows exist at once (the counts are the server's), the PDFs once the job ends.
    const issued = await issueCards(staff, exam.examId);
    expect(issued.added).toBe(roster);
    expect(issued.existing).toBe(0);
    const rendered = await awaitJobResult<RenderResult>(staff, issued.jobId);
    expect(rendered.rendered).toBe(roster);
    expect(rendered.failed).toEqual([]);

    const cards = await cardsOf(staff, exam.examId);
    expect(cards.map((card) => card.student_id).sort()).toEqual([...scaffold.studentIds].sort());
    for (const card of cards) {
      expect(card.section_id).toBe(scaffold.sectionId);
      expect(card.section_name).toBeTruthy();
      expect(card.student_name).toBeTruthy();
      expect(card.file_id).toBeTruthy();
      expect(card.status).toBe("issued");
    }

    const sectionFiltered = await staff.get<AdmitCard[]>("/admit-cards", {
      query: { exam_id: exam.examId, section_id: scaffold.sectionId },
    });
    expect(sectionFiltered.data).toHaveLength(roster);

    const [card] = cards;
    if (!card) throw new Error("no admit card was issued");
    const download = await staff.post<{ download_url: string }>(`/admit-cards/${card.id}:download`);
    expect(download.data.download_url).toMatch(/^https?:\/\//);

    // A revoke needs a reason, then withdraws the card's document.
    const noReason = await refusal(staff.post(`/admit-cards/${card.id}:revoke`, { reason: " " }));
    expect(noReason.status).toBe(400);
    const revoked = await staff.post<AdmitCard>(`/admit-cards/${card.id}:revoke`, {
      reason: REVOKE_REASON,
    });
    expect(revoked.data.status).toBe("revoked");
    expect(revoked.data.revoked_reason).toBe(REVOKE_REASON);
    const gone = await refusal(staff.post(`/admit-cards/${card.id}:download`));
    expect(gone.status).toBe(404);

    // A second run adds nothing and never reinstates the revoked card.
    const again = await issueCards(staff, exam.examId);
    expect(again.added).toBe(0);
    expect(again.existing).toBe(roster);
    await awaitJobResult<RenderResult>(staff, again.jobId);
    const after = await cardsOf(staff, exam.examId);
    expect(after).toHaveLength(roster);
    expect(after.find((row) => row.id === card.id)?.status).toBe("revoked");
  });
});
