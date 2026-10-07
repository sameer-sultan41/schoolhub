import {
  fetchAcademicSessions,
  fetchClasses,
  fetchHouses,
  fetchSections,
} from "./school-organization-service";

export const SchoolOrganizationService = {
  fetchHouses,
  fetchClasses,
  fetchSections,
  fetchAcademicSessions,
};
export type {
  AcademicSessionSummary,
  SchoolOrganizationOption,
} from "./school-organization-service";
