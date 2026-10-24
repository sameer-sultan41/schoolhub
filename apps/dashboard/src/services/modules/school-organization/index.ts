import {
  fetchAcademicSessions,
  fetchClasses,
  fetchHouses,
  fetchSections,
  fetchSubjects,
} from "./school-organization-service";

export const SchoolOrganizationService = {
  fetchHouses,
  fetchClasses,
  fetchSections,
  fetchSubjects,
  fetchAcademicSessions,
};
export type {
  AcademicSessionSummary,
  SchoolOrganizationOption,
  SectionOption,
} from "./school-organization-type";
