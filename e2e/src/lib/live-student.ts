import type { ApiClient } from "@schoolhub/api-client";
import {
  buildLiveEmergencyContact,
  buildLiveGuardian,
  buildLiveStudent,
} from "@/data/live-factories";

interface Identified {
  id: string;
}

/** The part of the created `Student` a spec reads back: its id and its name. */
export interface CreatedStudent extends Identified {
  first_name: string;
  last_name: string;
}

/**
 * A student `:enroll` will accept: the API refuses one with no guardian and no emergency
 * contact (`assert_enrollment_prerequisites`), so every live spec that enrols someone starts here.
 */
export async function createStudentReadyToEnrol(
  client: ApiClient,
  campusId: string,
): Promise<CreatedStudent> {
  const student = (await client.post("/students", { ...buildLiveStudent(), campus_id: campusId }))
    .data as CreatedStudent;
  const guardian = (await client.post("/guardians", buildLiveGuardian())).data as Identified;
  await client.post(`/students/${student.id}/guardians`, {
    guardian_id: guardian.id,
    relationship: "mother",
  });
  await client.post(`/students/${student.id}/emergency-contacts`, buildLiveEmergencyContact());
  return student;
}
