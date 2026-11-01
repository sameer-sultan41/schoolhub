import type { ApiClient } from "@schoolhub/api-client";
import { buildLiveExam, buildLiveSubject } from "@/data/live-factories";
import { env } from "@/env";
import { createLiveSession } from "@/lib/live-api";
import { seedAttendanceRegister } from "@/lib/live-attendance-register";
import { findSeededStaff } from "@/lib/live-timetable-grid";
import {
  E2E_EXAM_STAFF_EMAIL,
  E2E_TEACHER_EMAIL,
  E2E_TEACHER_LOGIN_EMPLOYEE_NUMBER,
} from "@/lib/seed-constants";

/**
 * The preconditions an exam needs, through the real API, shared by every examinations live spec
 * (setup here; schedule, marks and results in the PRs after it).
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

/** Weekly periods on the curriculum row: any positive number; nothing here reads it. */
const CURRICULUM_WEEKLY_PERIODS = 4;
/** The exam-subject's marks: decimals as strings, as the API serializes them. */
export const EXAM_SUBJECT_MAX_MARKS = "100.00";
export const EXAM_SUBJECT_PASS_MARKS = "40.00";

let examStaffLogin: Promise<ApiClient> | undefined;
let teacherLogin: Promise<ApiClient> | undefined;

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
    classId: register.classId,
    className: register.className,
    sectionId: register.sectionId,
    subjectId: subject.id,
    subjectName: subjectPayload.name,
    studentIds: register.studentIds,
  };
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
