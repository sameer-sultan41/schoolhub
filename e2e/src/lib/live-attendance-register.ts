import type { ApiClient } from "@schoolhub/api-client";
import { createStudentReadyToEnrol } from "@/lib/live-student";
import { seedTimetableScaffold, type TimetableScaffold } from "@/lib/live-timetable-grid";
import { E2E_BASELINE_SESSION_NAME } from "@/lib/seed-constants";

/**
 * A section with real enrolled students, which is the least an attendance register
 * needs to mean anything.
 *
 * Built on `seedTimetableScaffold` rather than on the baseline seed for the reason its
 * own header gives: everything here is run-unique, so two workers marking registers do
 * not collide on `student_attendance_one_per_day`. That constraint is per (student,
 * date) and the lane marks *today*, so a shared section would make the second worker's
 * first submission look like an update and the assertions lie.
 */

export interface RegisterStudent {
  id: string;
  /** `Student.full_name`, the name the register and Records show. */
  name: string;
}

export interface AttendanceRegister extends TimetableScaffold {
  studentIds: string[];
  students: RegisterStudent[];
}

/** The session the students are enrolled in, and the date they are enrolled from. */
export interface RegisterSession {
  id: string;
  name: string;
  enrollmentDate: string;
}

const ROSTER_SIZE = 3;
const ISO_DATE_LENGTH = 10;

/**
 * The session whose dates contain today: the seeded baseline (`seed_e2e_data` starts it 30
 * days back). A screen asks for a register by section and date only, and the server reads
 * the roster of the session containing the date (`services.session_for_date`), so a register
 * opened in the browser shows students only when they are enrolled here, not in the scaffold's
 * far-future session. Found by name, not `is_current`: the sessions spec briefly moves
 * "current" to a session of its own.
 */
export async function todaysSession(client: ApiClient): Promise<RegisterSession> {
  const listed = await client.get<{ id: string; name: string }[]>("/academic-sessions", {
    query: { search: E2E_BASELINE_SESSION_NAME },
  });
  const found = listed.data.find((row) => row.name === E2E_BASELINE_SESSION_NAME);
  if (!found) {
    throw new Error("the seeded baseline session is missing — run manage.py seed_e2e_data");
  }
  return { id: found.id, name: found.name, enrollmentDate: today() };
}

/**
 * Enrols the run-unique roster in `session`, or in the scaffold's own far-future session when
 * none is given. Anything that marks or reads today's register needs `todaysSession`: the
 * server refuses a session that does not contain the date (422 on `academic_session_id`).
 */
export async function seedAttendanceRegister(
  client: ApiClient,
  session?: RegisterSession,
): Promise<AttendanceRegister> {
  const scaffold = await seedTimetableScaffold(client);
  const enrolIn = session ?? {
    id: scaffold.sessionId,
    name: scaffold.sessionName,
    enrollmentDate: scaffold.sessionStartDate,
  };

  const students = await Promise.all(
    Array.from({ length: ROSTER_SIZE }, () => createStudentReadyToEnrol(client, scaffold.campusId)),
  );

  // Sequential, not Promise.all: enrolment allocates a roll number per section and
  // `student_enrollments_unique_roll_per_section` is what decides the race. Three rows
  // is not worth the flake.
  for (const student of students) {
    await client.post(`/students/${student.id}:enroll`, {
      academic_session_id: enrolIn.id,
      class_id: scaffold.classId,
      section_id: scaffold.sectionId,
      enrollment_date: enrolIn.enrollmentDate,
    });
  }

  return {
    ...scaffold,
    sessionId: enrolIn.id,
    sessionName: enrolIn.name,
    studentIds: students.map((student) => student.id),
    students: students.map((student) => ({
      id: student.id,
      name: `${student.first_name} ${student.last_name}`,
    })),
  };
}

/**
 * Today on the server's calendar: `timezone.localdate()` under `TIME_ZONE = "UTC"`, which is
 * also the dashboard's `todayIsoDate()`. Never the machine's local date, which is a day off
 * either side of UTC midnight (L20).
 */
export function today(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}
