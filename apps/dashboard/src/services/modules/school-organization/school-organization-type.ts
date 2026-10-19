import type { ApiSchemas } from "@schoolhub/api-client";

/** The slice of the generated `House` schema a reference-data select/filter reads — derived
 * from the contract, not hand-written, per ADR-0017. */
export type SchoolOrganizationOption = Pick<ApiSchemas["House"], "id" | "name">;

/** A section as a picker sees it, with its campus: the timetable grid draws the periods and
 * rooms of the section's own campus. */
export type SectionOption = Pick<ApiSchemas["Section"], "id" | "name" | "campus_id">;

/** The slice of the generated `AcademicSession` schema a session picker reads. */
export type AcademicSessionSummary = Pick<
  ApiSchemas["AcademicSession"],
  "id" | "name" | "status" | "is_current"
>;
