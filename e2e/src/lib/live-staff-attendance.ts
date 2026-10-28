import type { ApiClient } from "@schoolhub/api-client";
import { buildLiveTeacher } from "@/data/live-factories";
import { E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER } from "@/lib/seed-constants";

/**
 * A run-unique staff member for the staff attendance lane.
 *
 * `staff_attendance` holds one row per (staff, date), so the seeded teacher can be recorded once
 * per date for the life of the database: a second worker, or the next run against the same
 * database, would meet the first one's row. A member created per test never does.
 */

export interface LiveStaffMember {
  id: string;
  first_name: string;
  last_name: string;
  employee_number: string;
  campus_id: string;
}

/** The seeded campus, read off the seeded teacher, so a new member sits beside them. */
async function seededTeacherCampus(client: ApiClient): Promise<string> {
  const listed = await client.get<{ employee_number: string; campus_id: string }[]>("/staff", {
    query: { search: E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER },
  });
  const found = listed.data.find(
    (row) => row.employee_number === E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER,
  );
  if (!found) {
    throw new Error(
      `no seeded staff ${E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER} — run manage.py seed_e2e_data`,
    );
  }
  return found.campus_id;
}

/** A new active teacher on the seeded campus; `joining_date` defaults to `buildLiveTeacher`'s
 * fixed `2026-01-01`. */
export async function createLiveStaff(
  client: ApiClient,
  overrides: { joining_date?: string } = {},
): Promise<LiveStaffMember> {
  const campusId = await seededTeacherCampus(client);
  const created = await client.post<LiveStaffMember>("/staff", {
    ...buildLiveTeacher(campusId),
    ...overrides,
  });
  return created.data;
}
