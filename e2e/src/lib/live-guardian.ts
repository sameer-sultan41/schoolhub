import type { ApiClient } from "@schoolhub/api-client";
import { E2E_GUARDIAN_PHONE } from "@/lib/seed-constants";

/**
 * Links the seeded guardian (`seed_e2e_data.py`) to `studentId`, so the guardian login can
 * act for that student.
 *
 * §11 makes a leave requester the student or a *linked* guardian, and the seed deliberately
 * links nobody: every spec builds run-unique students, so a link made here belongs to this
 * run only and never chains two specs together through one shared child. `admin` needs
 * `students.guardian.view` (to find the guardian) and `.create` (to link), which the seeded
 * owner holds.
 */
export async function linkSeededGuardian(admin: ApiClient, studentId: string): Promise<void> {
  const listed = await admin.get<{ id: string; phone: string }[]>("/guardians", {
    query: { search: E2E_GUARDIAN_PHONE },
  });
  const guardian = listed.data.find((row) => row.phone === E2E_GUARDIAN_PHONE);
  if (!guardian) {
    throw new Error("the seeded guardian is missing — run manage.py seed_e2e_data");
  }
  await admin.post(`/students/${studentId}/guardians`, {
    guardian_id: guardian.id,
    relationship: "father",
    has_portal_access: true,
  });
}
