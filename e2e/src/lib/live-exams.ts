import { randomUUID } from "node:crypto";
import type { ApiClient } from "@schoolhub/api-client";
import { buildLiveExam, buildLiveSection, buildLiveSubject } from "@/data/live-factories";
import { env } from "@/env";
import { createLiveSession } from "@/lib/live-api";
import { seedAttendanceRegister } from "@/lib/live-attendance-register";
import { awaitJobResult, LIVE_JOB_TIMEOUT_MS } from "@/lib/live-jobs";
import { createStudentReadyToEnrol } from "@/lib/live-student";
import { findSeededStaff } from "@/lib/live-timetable-grid";
import {
  E2E_EXAM_STAFF_EMAIL,
  E2E_PRINCIPAL_EMAIL,
  E2E_TEACHER_EMAIL,
  E2E_TEACHER_LOGIN_EMPLOYEE_NUMBER,
} from "@/lib/seed-constants";

/**
 * The preconditions an exam needs, through the real API, shared by every examinations live spec
 * (setup, schedule, marks and results).
 *
 * **Run-unique, on the attendance register's scaffold.** `seedAttendanceRegister` already builds
 * a campus, class, section and a far-future session of the worker's own date band
 * (`farFutureSessionWindow`), and enrols a small active roster in it; this adds the one thing an
 * exam-subject needs on top, a subject on that class's curriculum for that session
 * (`assert_subject_in_class_curriculum`). Nothing is shared with another spec or worker, so a
 * roll number, a marks row or a teacher's allocation never meets another test's.
 *
 * **Who writes what.** The scaffold and the teacher's allocation are the worker's admin
 * (`liveApiClient`), since `exam_staff` holds no structure or academics write keys; the exam
 * itself is written by the seeded `exam_staff` (`examStaffSession`), so a key the real role
 * lacks fails the spec instead of passing on the admin's wider set.
 *
 * **One login per identity per worker** (`AuthEndpointThrottle`, e2e/AGENTS.md): the sessions
 * below are memoised for the worker's lifetime, the `guardianSession` pattern in
 * `attendance-leave.spec.ts`. A worker that never asks for one never logs it in.
 */

interface Identified {
  id: string;
}

export interface ExamScaffold {
  campusId: string;
  sessionId: string;
  sessionName: string;
  /** The session's first day, years from today (`farFutureSessionWindow`). */
  sessionStartDate: string;
  classId: string;
  className: string;
  sectionId: string;
  /** The subject on the class's curriculum for the session: the one an exam-subject may name. */
  subjectId: string;
  subjectName: string;
  /** The active roster, enrolled in the scaffold's session and section. */
  studentIds: string[];
}

export interface ExamWithSubject {
  examId: string;
  examName: string;
  examSubjectId: string;
}

/** What an examinations live test spends outside its polled jobs: up to four cold logins (admin,
 * exam staff, teacher, principal, or one browser sign-in), the scaffold's dozen-odd writes, and
 * the synchronous actions and reads around the jobs. */
export const LIVE_EXAM_SETUP_MARGIN_MS = 30_000;

/** A test's budget when it awaits `jobs` Celery jobs, each allowed `LIVE_JOB_TIMEOUT_MS` (L6). */
export function liveExamTimeout(jobs: number): number {
  return jobs * LIVE_JOB_TIMEOUT_MS + LIVE_EXAM_SETUP_MARGIN_MS;
}

/** Weekly periods on the curriculum row: any positive number; nothing here reads it. */
const CURRICULUM_WEEKLY_PERIODS = 4;
/** The exam-subject's marks: decimals as strings, as the API serializes them. */
export const EXAM_SUBJECT_MAX_MARKS = "100.00";
export const EXAM_SUBJECT_PASS_MARKS = "40.00";

let examStaffLogin: Promise<ApiClient> | undefined;
let teacherLogin: Promise<ApiClient> | undefined;
let principalLogin: Promise<ApiClient> | undefined;

/** Clears `reset`'s memo when `login` rejects, so one failed login does not fail every later
 * test in the worker with the same cached rejection. */
function forgetOnFailure(login: Promise<ApiClient>, reset: () => void): Promise<ApiClient> {
  login.catch(reset);
  return login;
}

/** The seeded `exam_staff` (all scope), one login per worker. */
export function examStaffSession(): Promise<ApiClient> {
  examStaffLogin ??= forgetOnFailure(
    createLiveSession({
      identifier: E2E_EXAM_STAFF_EMAIL,
      // Every seeded e2e login shares the admin's password (seed_e2e_data.py).
      password: env.LIVE_ADMIN_PASSWORD,
    }),
    () => {
      examStaffLogin = undefined;
    },
  );
  return examStaffLogin;
}

/** The seeded `teacher` (assigned scope), one login per worker. */
export function teacherSession(): Promise<ApiClient> {
  teacherLogin ??= forgetOnFailure(
    createLiveSession({
      identifier: E2E_TEACHER_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    }),
    () => {
      teacherLogin = undefined;
    },
  );
  return teacherLogin;
}

/** The seeded `principal` (all scope), one login per worker: the results approver, who holds
 * `exams.result.approve` and `.publish` and never `.create` (seed_e2e_data.py). */
export function principalSession(): Promise<ApiClient> {
  principalLogin ??= forgetOnFailure(
    createLiveSession({
      identifier: E2E_PRINCIPAL_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    }),
    () => {
      principalLogin = undefined;
    },
  );
  return principalLogin;
}

/** A run-unique session, class, section, curriculum row and enrolled roster. */
export async function seedExamScaffold(client: ApiClient): Promise<ExamScaffold> {
  const register = await seedAttendanceRegister(client);
  const subjectPayload = buildLiveSubject();
  const subject = (await client.post("/subjects", subjectPayload)).data as Identified;
  await client.post("/class-subjects", {
    academic_session_id: register.sessionId,
    class_id: register.classId,
    subject_id: subject.id,
    weekly_periods: CURRICULUM_WEEKLY_PERIODS,
  });

  return {
    campusId: register.campusId,
    sessionId: register.sessionId,
    sessionName: register.sessionName,
    sessionStartDate: register.sessionStartDate,
    classId: register.classId,
    className: register.className,
    sectionId: register.sectionId,
    subjectId: subject.id,
    subjectName: subjectPayload.name,
    studentIds: register.studentIds,
  };
}

/** Puts one more subject on the scaffold class's curriculum (as `adminClient`, which holds the
 * academics keys) and adds it to the exam (as `examClient`): a second paper the same section
 * sits, for a schedule spec that needs two sittings of one section. Returns the exam-subject's
 * id. */
export async function addExamSubject(
  adminClient: ApiClient,
  examClient: ApiClient,
  scaffold: ExamScaffold,
  examId: string,
): Promise<string> {
  const subject = (await adminClient.post("/subjects", buildLiveSubject())).data as Identified;
  await adminClient.post("/class-subjects", {
    academic_session_id: scaffold.sessionId,
    class_id: scaffold.classId,
    subject_id: subject.id,
    weekly_periods: CURRICULUM_WEEKLY_PERIODS,
  });
  const examSubject = await examClient.post("/exam-subjects", {
    exam_id: examId,
    class_id: scaffold.classId,
    subject_id: subject.id,
    max_marks: EXAM_SUBJECT_MAX_MARKS,
    pass_marks: EXAM_SUBJECT_PASS_MARKS,
  });
  return (examSubject.data as Identified).id;
}

const MONDAY = 1;
const ISO_DATE_LENGTH = 10;

/**
 * The scaffold session's first Monday: a working day under any school week, and inside the
 * session, so a sitting on it is never `not_a_working_day` (a hard finding that would hold a
 * publish for a reason the spec did not ask for).
 */
export function firstExamDay(scaffold: ExamScaffold): string {
  const day = new Date(`${scaffold.sessionStartDate}T00:00:00Z`);
  while (day.getUTCDay() !== MONDAY) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, ISO_DATE_LENGTH);
}

/** A draft exam in the scaffold's session with the scaffold's subject on it, written by
 * `client` (the exam staff, in every spec so far). */
export async function createExamWithSubject(
  client: ApiClient,
  scaffold: ExamScaffold,
): Promise<ExamWithSubject> {
  const payload = buildLiveExam(scaffold.sessionId);
  const exam = (await client.post("/exams", payload)).data as Identified;
  const examSubject = (
    await client.post("/exam-subjects", {
      exam_id: exam.id,
      class_id: scaffold.classId,
      subject_id: scaffold.subjectId,
      max_marks: EXAM_SUBJECT_MAX_MARKS,
      pass_marks: EXAM_SUBJECT_PASS_MARKS,
    })
  ).data as Identified;
  return { examId: exam.id, examName: payload.name, examSubjectId: examSubject.id };
}

/** The `Staff` row behind `E2E_TEACHER_EMAIL`, by its seeded employee number. */
export async function teacherLoginStaffId(client: ApiClient): Promise<string> {
  return (await findSeededStaff(client, E2E_TEACHER_LOGIN_EMPLOYEE_NUMBER)).id;
}

/**
 * Allocates `staffId` to teach the scaffold's subject in its section and session: what makes an
 * `assigned` teacher see the exams with that (class, subject) in that session
 * (`Exam.filter_assigned_to_user`). Run-unique by construction, so `tsa_unique_allocation`
 * never refuses a rerun. Returns the allocation's id.
 */
export async function allocateTeacher(
  client: ApiClient,
  scaffold: ExamScaffold,
  staffId: string,
): Promise<string> {
  const allocation = await client.post("/teacher-subject-allocations", {
    academic_session_id: scaffold.sessionId,
    section_id: scaffold.sectionId,
    subject_id: scaffold.subjectId,
    staff_id: staffId,
  });
  return (allocation.data as Identified).id;
}

/** A second section of the scaffold's class and the student enrolled in it. */
export interface EnrolledSection {
  sectionId: string;
  studentIds: string[];
}

/**
 * A second section of the scaffold's class, on its campus, with one student actively enrolled
 * in the scaffold's session: a section of the same exam-subject that a teacher allocated to the
 * first section does not teach, so progress lists it for the exam staff and not for them.
 */
export async function addEnrolledSection(
  client: ApiClient,
  scaffold: ExamScaffold,
): Promise<EnrolledSection> {
  const section = (
    await client.post("/sections", {
      ...buildLiveSection(),
      class_id: scaffold.classId,
      campus_id: scaffold.campusId,
    })
  ).data as Identified;
  const student = await createStudentReadyToEnrol(client, scaffold.campusId);
  await client.post(`/students/${student.id}:enroll`, {
    academic_session_id: scaffold.sessionId,
    class_id: scaffold.classId,
    section_id: section.id,
    enrollment_date: scaffold.sessionStartDate,
  });
  return { sectionId: section.id, studentIds: [student.id] };
}

/**
 * Schedules the exam's subject for the scaffold's section on its first exam day and publishes
 * the schedule, as `client` (the exam staff): the exam moves to `scheduled`, one of the statuses
 * that take marks (`services.MARKS_WRITABLE_EXAM_STATUSES`). No entry window is set, and an unset
 * window is open (`assert_marks_window_open`).
 */
export async function publishExamForMarks(
  client: ApiClient,
  scaffold: ExamScaffold,
  exam: ExamWithSubject,
): Promise<void> {
  await client.post("/exam-schedules", {
    exam_subject_id: exam.examSubjectId,
    section_id: scaffold.sectionId,
    exam_date: firstExamDay(scaffold),
    start_time: "09:00",
    end_time: "11:00",
  });
  await client.post(`/exams/${exam.examId}:publish-schedule`);
}

/** The theory mark `submitSectionMarks` gives every student but the first (absent). */
export const EXAM_THEORY_MARK = "72.50";

/** `:bulk-entry`'s 200: rows created, rows updated, rows sent. */
export interface BulkEntryResult {
  entered: number;
  updated: number;
  rows: number;
}

/**
 * `:bulk-entry` for one section, every student as `submitted`: the first absent, the rest with
 * `EXAM_THEORY_MARK`. A fresh `Idempotency-Key` each call, so a repeat is a new submission.
 */
export function submitSectionMarks(
  client: ApiClient,
  examSubjectId: string,
  sectionId: string,
  studentIds: readonly string[],
) {
  return client.post<BulkEntryResult>(
    "/marks:bulk-entry",
    {
      exam_subject_id: examSubjectId,
      section_id: sectionId,
      entries: studentIds.map((studentId, index) =>
        index === 0
          ? { student_id: studentId, is_absent: true, status: "submitted" }
          : { student_id: studentId, theory_marks: EXAM_THEORY_MARK, status: "submitted" },
      ),
    },
    { idempotencyKey: randomUUID() },
  );
}

/** A `202`'s body: the job to poll. */
export interface JobAccepted {
  job_id: string;
  status: "queued";
}

/** `process_exam_results`' outcome, the processing job's `result`. */
export interface ProcessOutcome {
  created: number;
  updated: number;
  students: number;
}

/** `:process-results` as `client`, awaiting its job (polled as `client`, which holds
 * `platform.job.view`) and returning the job's outcome. */
export async function processResults(client: ApiClient, examId: string): Promise<ProcessOutcome> {
  const accepted = await client.post<JobAccepted>(`/exams/${examId}:process-results`, undefined, {
    idempotencyKey: randomUUID(),
  });
  return awaitJobResult<ProcessOutcome>(client, accepted.data.job_id);
}

/** An exam `buildProcessedExam` took to `processing`, with the run that put it there. */
export interface ProcessedExam {
  scaffold: ExamScaffold;
  exam: ExamWithSubject;
  processed: ProcessOutcome;
}

/**
 * A run-unique exam, built through the real API to `processing`: its results awaiting approval,
 * processed by the exam staff (so neither the principal nor the worker's admin ran it).
 *
 * The admin builds the scaffold; the exam staff writes the exam, publishes its schedule, locks the
 * marks and processes. The marks are entered by `teacher` when given (allocated to the section
 * first, the `assigned` path), else by the exam staff (`all` scope), which spares a worker that
 * needs no teacher the teacher's login.
 */
export async function buildProcessedExam(
  adminClient: ApiClient,
  { teacher }: { teacher?: ApiClient } = {},
): Promise<ProcessedExam> {
  const staff = await examStaffSession();
  const scaffold = await seedExamScaffold(adminClient);
  const exam = await createExamWithSubject(staff, scaffold);
  if (teacher) {
    await allocateTeacher(adminClient, scaffold, await teacherLoginStaffId(adminClient));
  }
  await publishExamForMarks(staff, scaffold, exam);

  const entrant = teacher ?? staff;
  await submitSectionMarks(entrant, exam.examSubjectId, scaffold.sectionId, scaffold.studentIds);
  await staff.post(`/exam-subjects/${exam.examSubjectId}:lock-marks`);
  const processed = await processResults(staff, exam.examId);
  return { scaffold, exam, processed };
}
