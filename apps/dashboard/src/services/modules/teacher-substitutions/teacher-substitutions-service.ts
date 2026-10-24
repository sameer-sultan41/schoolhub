import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toSubstitutionBody, toSubstitutionQueryParams } from "./teacher-substitutions-helper";
import type {
  ProposeSubstitutionInput,
  SubstituteCandidate,
  SubstitutionPageQuery,
  TeacherSubstitutionRecord,
} from "./teacher-substitutions-type";

/** Cover's API calls (`/teacher-substitutions`), reached through `Services.teacherSubstitutions.*`. */

export async function fetchSubstitutionPage(
  query: SubstitutionPageQuery,
): Promise<Page<TeacherSubstitutionRecord>> {
  return fetchPage<TeacherSubstitutionRecord>(apiClient, endpoints.teacherSubstitutions.list, {
    query: toSubstitutionQueryParams(query),
  });
}

export async function proposeSubstitution(
  input: ProposeSubstitutionInput,
): Promise<TeacherSubstitutionRecord> {
  const { data } = await apiClient.post<TeacherSubstitutionRecord>(
    endpoints.teacherSubstitutions.list,
    toSubstitutionBody(input),
  );
  return data;
}

/** The teachers free to cover `slotId` on `date`, by name (`services.free_substitutes`). */
export async function fetchCandidates(
  slotId: string,
  date: string,
): Promise<SubstituteCandidate[]> {
  const { data } = await apiClient.get<SubstituteCandidate[]>(
    endpoints.teacherSubstitutions.candidates,
    {
      query: { timetable_slot_id: slotId, date },
    },
  );
  return data;
}

export type SubstitutionAction = "approve" | "reject" | "cancel";

/** `:approve`, `:reject` or `:cancel`: each answers with the cover as it now stands. */
export async function decideSubstitution(
  id: string,
  action: SubstitutionAction,
): Promise<TeacherSubstitutionRecord> {
  const { data } = await apiClient.post<TeacherSubstitutionRecord>(
    endpoints.teacherSubstitutions.action(id, action),
    {},
  );
  return data;
}
