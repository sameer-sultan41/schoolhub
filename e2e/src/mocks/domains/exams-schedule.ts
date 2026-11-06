import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, ok } from "../envelope";
import { cursorPageOf, nameOf, type Named } from "../list";
import type { MockModule } from "../router";
import type { Exam } from "./exams-setup";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a status, a file, a reason). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time. */
export type ExamSitting = Writable<ApiSchemas["ExamSchedule"]>;
export type ExamConflict = ApiSchemas["ExamConflict"];
export type AdmitCard = Writable<ApiSchemas["AdmitCard"]>;

const STAMP = "2026-04-01T00:00:00Z";
// The server's fixed `meta.message`; the counts a client renders are typed `data`.
const ISSUE_MESSAGE = "Admit cards queued for rendering.";

export function buildSitting(overrides: Partial<ExamSitting> = {}): ExamSitting {
  return {
    id: uuid(),
    exam_id: "",
    exam_name: "Midterm 2026",
    exam_subject_id: "",
    subject_name: "Mathematics",
    class_name: "Grade 1",
    section_id: "",
    section_name: "A",
    exam_date: "2026-10-05",
    start_time: "09:00:00",
    end_time: "11:00:00",
    room_id: null,
    room_name: null,
    invigilator_staff_id: null,
    invigilator_name: null,
    status: "scheduled",
    instructions: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** A student the exam issues a card to: an active enrollment in one of its sections. */
export interface ExamCandidate {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  sectionId: string;
  sectionName: string;
}

export interface ExamsScheduleOptions {
  /** The same objects `examsSetupModule` serves: a publish moves `status`, and the exam page's
   * own `GET /exams/{id}` then shows it. */
  exams: Exam[];
  sittings?: ExamSitting[];
  /** Who sits the exam, by section (`admit_card_candidates`). */
  candidates?: ExamCandidate[];
  admitCards?: AdmitCard[];
  /** The rooms a written sitting's `room_name` is looked up in. */
  rooms?: Named[];
}

/** `HH:MM` from the form, `HH:MM:SS` on the wire. */
function toWireTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

const short = (time: string) => time.slice(0, 5);

/** Two sittings of the same day overlap when each starts before the other ends. */
function overlaps(a: ExamSitting, b: ExamSitting): boolean {
  return a.exam_date === b.exam_date && a.start_time < b.end_time && b.start_time < a.end_time;
}

/**
 * The clash engine, cut down to the one finding the schedule spec drives: a room booked for two
 * overlapping sittings (`conflicts.ROOM_DOUBLE_BOOKED`, hard), in the server's words. Cancelled
 * sittings free their room, as `OCCUPYING_SCHEDULE_STATUSES` says.
 */
function detectConflicts(sittings: readonly ExamSitting[]): ExamConflict[] {
  const live = sittings.filter((row) => row.status !== "cancelled");
  const found: ExamConflict[] = [];
  live.forEach((earlier, index) => {
    for (const later of live.slice(index + 1)) {
      if (earlier.room_id && earlier.room_id === later.room_id && overlaps(earlier, later)) {
        found.push({
          type: "room_double_booked",
          severity: "hard",
          schedule_ids: [earlier.id, later.id],
          message:
            `Room ${earlier.room_name ?? ""} is booked twice on ${earlier.exam_date}: ` +
            `${short(earlier.start_time)}-${short(earlier.end_time)} and ` +
            `${short(later.start_time)}-${short(later.end_time)}.`,
        });
      }
    }
  });
  return found;
}

/** `services.ADMIT_CARD_NUMBER_TEMPLATE`: the exam's first eight id characters, then the
 * admission number. */
function cardNumber(exam: Exam, admissionNumber: string): string {
  return `${exam.id.slice(0, 8).toUpperCase()}-${admissionNumber}`;
}

/**
 * An exam's schedule and admit cards: `/exam-schedules` (list, reschedule), the clash list
 * (`/exams/{id}/schedule-conflicts`), `/exams/{id}:publish-schedule`, `:issue-admit-cards` with
 * its render job (`/jobs/{id}`), and `/admit-cards` (list, `:revoke`, `:download`).
 *
 * Mirrors the server's rules the screens surface (lesson L5), in its words:
 * - a hard clash refuses a publish with a 422 whose `error.meta.conflicts` holds every finding,
 *   and a schedule with no sittings has nothing to publish; a publish moves the exam to
 *   `scheduled`;
 * - issuing refuses a draft exam (409, `assert_exam_is_issuable`), creates a card only for a
 *   candidate in a section the exam sits that has none yet (a revoked card is never re-created,
 *   so never reinstated), answers `202` with the added and existing counts in `meta.message`, and
 *   replays the first answer for a repeated `Idempotency-Key`;
 * - the render job writes a PDF for every live card without one, and succeeds at once;
 * - a revoke needs a reason (400 under `reason`) and refuses a revoked card (409);
 * - `:download` is a 404 for a card with no file or a revoked one.
 *
 * Owns `GET /jobs/:jobId`, so a spec using this module does not also use `jobsModule` (the
 * router has no fallthrough: a second handler on the path would shadow the first). Whether the
 * server really enforces any of this is the live lane's (`tests/live/api/exams-schedule.spec.ts`).
 */
export function examsScheduleModule(options: ExamsScheduleOptions): MockModule {
  return (api) => {
    const { exams } = options;
    const sittings = [...(options.sittings ?? [])];
    const candidates = options.candidates ?? [];
    const cards = [...(options.admitCards ?? [])];
    const rooms = options.rooms ?? [];
    const jobs = new Map<string, { rendered: number; cards: number }>();
    const replays = new Map<string, { jobId: string; added: number; existing: number }>();

    const findExam = (examId: string | undefined) => exams.find((row) => row.id === examId);
    const sittingsOf = (exam: Exam) => sittings.filter((row) => row.exam_id === exam.id);

    api.get("/exam-schedules", (request) => {
      const examId = request.searchParams.get("exam_id");
      const matching = sittings.filter((row) => !examId || row.exam_id === examId);
      return cursorPageOf(matching, request.searchParams);
    });

    api.patch("/exam-schedules/:rowId", (request) => {
      const row = sittings.find((candidate) => candidate.id === request.params["rowId"]);
      const exam = findExam(row?.exam_id);
      if (!row || !exam) return fail(404, "Not found.");
      if (row.status !== "scheduled") {
        return fail(409, `This sitting is ${row.status ?? ""}, so it can no longer be changed.`);
      }
      const body = (request.json() as Partial<ExamSitting> | null) ?? {};
      Object.assign(row, body, { updated_at: "2026-09-02T00:00:00Z" });
      row.start_time = toWireTime(row.start_time);
      row.end_time = toWireTime(row.end_time);
      if ("room_id" in body) row.room_name = nameOf(rooms, row.room_id);
      return ok(row, { meta: { conflicts: detectConflicts(sittingsOf(exam)) } });
    });

    api.get("/exams/:examId/schedule-conflicts", (request) => {
      const exam = findExam(request.params["examId"]);
      return exam ? ok(detectConflicts(sittingsOf(exam))) : fail(404, "Not found.");
    });

    // `router.ts` reads `:name` as a param, so `/exams/{id}:publish-schedule` and
    // `/exams/{id}:issue-admit-cards` both land here whole.
    api.post("/exams/:examAction", (request) => {
      const [examId, action] = (request.params["examAction"] ?? "").split(":");
      const exam = findExam(examId);
      if (!exam) return fail(404, "Not found.");

      if (action === "publish-schedule") {
        if (exam.status !== "draft" && exam.status !== "scheduled") {
          return fail(409, "Only a draft or scheduled exam's schedule can be published.");
        }
        const findings = detectConflicts(sittingsOf(exam));
        const hard = findings.filter((finding) => finding.severity === "hard");
        if (hard.length > 0) {
          const refused = fail(
            422,
            `${hard.length} clash(es) must be resolved before this schedule can be published.`,
            { code: "domain_rule_violation" },
          );
          return {
            ...refused,
            body: { error: { ...refused.body.error, meta: { conflicts: findings } } },
          };
        }
        if (sittingsOf(exam).length === 0) {
          const issue = "This exam has no sittings scheduled yet, so there is nothing to publish.";
          return fail(422, issue, {
            code: "domain_rule_violation",
            details: [{ field: "exam_id", issue }],
          });
        }
        exam.status = "scheduled";
        return ok(
          { status: exam.status, conflicts: findings },
          { meta: { message: "Schedule published. Students and guardians have been notified." } },
        );
      }

      if (action === "issue-admit-cards") {
        const key = request.headers["idempotency-key"];
        const replay = key ? replays.get(key) : undefined;
        if (replay) {
          return ok(
            {
              job_id: replay.jobId,
              status: "queued",
              added: replay.added,
              existing: replay.existing,
            },
            { status: 202, meta: { message: ISSUE_MESSAGE } },
          );
        }
        if (exam.status === "draft") {
          return fail(
            409,
            "This exam's schedule has not been published, so an admit card would print dates " +
              "that are still being edited. Publish the schedule first.",
          );
        }
        const sectionIds = new Set(
          sittingsOf(exam)
            .filter((row) => row.status !== "cancelled")
            .map((row) => row.section_id),
        );
        const existing = cards.filter((card) => card.exam_id === exam.id);
        const holders = new Set(existing.map((card) => card.student_id));
        const added = candidates
          .filter((student) => sectionIds.has(student.sectionId) && !holders.has(student.studentId))
          .map((student): AdmitCard => ({
            id: uuid(),
            exam_id: exam.id,
            student_id: student.studentId,
            student_name: student.studentName,
            admission_number: student.admissionNumber,
            section_id: student.sectionId,
            section_name: student.sectionName,
            admit_card_no: cardNumber(exam, student.admissionNumber),
            file_id: null,
            status: "generated",
            issued_at: null,
            revoked_reason: null,
            created_at: STAMP,
            updated_at: STAMP,
          }));
        cards.push(...added);

        // The render job, run at once: a PDF for every live card of the exam without one.
        const toRender = cards.filter(
          (card) => card.exam_id === exam.id && card.file_id === null && card.status !== "revoked",
        );
        for (const card of toRender) {
          card.file_id = uuid();
          card.status = "issued";
          card.issued_at = "2026-09-02T00:00:00Z";
        }
        const jobId = uuid();
        jobs.set(jobId, { rendered: toRender.length, cards: toRender.length });

        const counts = { added: added.length, existing: existing.length };
        if (key) replays.set(key, { jobId, ...counts });
        return ok(
          { job_id: jobId, status: "queued", ...counts },
          { status: 202, meta: { message: ISSUE_MESSAGE } },
        );
      }

      return fail(404, "Not found.");
    });

    api.get("/jobs/:jobId", (request) => {
      const jobId = request.params["jobId"] ?? "";
      const job = jobs.get(jobId);
      if (!job) return fail(404, "Job not found.");
      return ok({
        id: jobId,
        job_type: "exams.admit-cards",
        status: "succeeded",
        progress: 100,
        result: { rendered: job.rendered, failed: [], cards: job.cards },
        error: null,
      });
    });

    api.get("/admit-cards", (request) => {
      const params = request.searchParams;
      const examId = params.get("exam_id");
      const sectionId = params.get("section_id");
      const status = params.get("status");
      const matching = cards
        .filter(
          (card) =>
            (!examId || card.exam_id === examId) &&
            (!sectionId || card.section_id === sectionId) &&
            (!status || card.status === status),
        )
        .sort((a, b) => a.admit_card_no.localeCompare(b.admit_card_no));
      return cursorPageOf(matching, params);
    });

    // `/admit-cards/{id}:revoke` and `:download`, the same colon-action split as above.
    api.post("/admit-cards/:cardAction", (request) => {
      const [cardId, action] = (request.params["cardAction"] ?? "").split(":");
      const card = cards.find((row) => row.id === cardId);
      if (!card) return fail(404, "Not found.");

      if (action === "revoke") {
        const reason = ((request.json() as { reason?: string } | null)?.reason ?? "").trim();
        if (reason === "") {
          return fail(400, "Validation failed.", {
            details: [{ field: "reason", issue: "This field may not be blank." }],
          });
        }
        if (card.status === "revoked") return fail(409, "This admit card is already revoked.");
        card.status = "revoked";
        card.revoked_reason = reason;
        return ok(card, { meta: { message: "Admit card revoked." } });
      }

      if (action === "download") {
        if (card.file_id === null || card.status === "revoked") {
          return fail(404, "This admit card has no document to download.");
        }
        return ok({ download_url: `https://storage.e2e.test/admit-cards/${card.id}.pdf` });
      }

      return fail(404, "Not found.");
    });
  };
}
