import {
  decideSubstitution,
  fetchCandidates,
  fetchSubstitutionPage,
  proposeSubstitution,
} from "./teacher-substitutions-service";

export const TeacherSubstitutionsService = {
  fetchSubstitutionPage,
  proposeSubstitution,
  fetchCandidates,
  decideSubstitution,
};
export type { SubstitutionAction } from "./teacher-substitutions-service";
export type {
  ProposeSubstitutionInput,
  SubstituteCandidate,
  SubstitutionPageQuery,
  SubstitutionStatus,
  TeacherSubstitutionRecord,
} from "./teacher-substitutions-type";
