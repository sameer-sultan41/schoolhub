import type { ApiClient } from "@schoolhub/api-client";
import { buildLiveStudent } from "@/data/live-factories";
import { seedTimetableScaffold, type TimetableScaffold } from "@/lib/live-timetable-grid";

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

interface Identified {
  id: string;
}

export interface AttendanceRegister extends TimetableScaffold {
  studentIds: string[];
}

const ROSTER_SIZE = 3;

export async function seedAttendanceRegister(client: ApiClient): Promise<AttendanceRegister> {
  const scaffold = await seedTimetableScaffold(client);

  const students = await Promise.all(
    Array.from({ length: ROSTER_SIZE }, () =>
      client.post("/students", { ...buildLiveStudent(), campus_id: scaffold.campusId }),
    ),
  ).then((responses) => responses.map((response) => response.data as Identified));

  // Sequential, not Promise.all: enrolment allocates a roll number per section and
  // `student_enrollments_unique_roll_per_section` is what decides the race. Three rows
  // is not worth the flake.
  for (const student of students) {
    await client.post(`/students/${student.id}:enroll`, {
      academic_session_id: scaffold.sessionId,
      class_id: scaffold.classId,
      section_id: scaffold.sectionId,
      enrollment_date: scaffold.sessionStartDate,
    });
  }

  return { ...scaffold, studentIds: students.map((student) => student.id) };
}

/** Today, in the tenant's own calendar terms — which is the only date the lane can mark. */
export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
