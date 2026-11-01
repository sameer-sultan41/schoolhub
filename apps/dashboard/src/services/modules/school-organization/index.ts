import {
  fetchAcademicSessions,
  fetchClasses,
  fetchHouses,
  fetchSections,
  fetchSubjects,
  fetchTerms,
} from "./school-organization-service";

export const SchoolOrganizationService = {
  fetchHouses,
  fetchClasses,
  fetchSections,
  fetchSubjects,
  fetchAcademicSessions,
  fetchTerms,
};
export type {
  AcademicSessionSummary,
  SchoolOrganizationOption,
  SectionOption,
  TermOption,
} from "./school-organization-type";
