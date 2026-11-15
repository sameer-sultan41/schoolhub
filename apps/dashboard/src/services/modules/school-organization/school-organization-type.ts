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

/** The slice of the generated `Term` schema an exam form's term picker reads. */
export type TermOption = Pick<ApiSchemas["Term"], "id" | "name" | "sequence">;

// The School module's structure screens: the generated wire shapes (ADR-0017).

export type CampusRecord = ApiSchemas["Campus"];
export type DepartmentRecord = ApiSchemas["Department"];
export type DepartmentType = ApiSchemas["DepartmentTypeEnum"];
export type HouseRecord = ApiSchemas["House"];
export type HolidayEntry = ApiSchemas["HolidayEntry"];
/** `GET /holiday-calendar` always answers both lists; the schema's optional keys describe the
 * `PUT` body, which names only the lists it replaces. */
export type HolidayCalendarRecord = Required<ApiSchemas["HolidayCalendar"]>;
export type HolidayCalendarUpdate = ApiSchemas["HolidayCalendar"];

/** The bodies the structure forms send, in the API's own field names. */
export type CampusInput = Required<
  Pick<CampusRecord, "name" | "code" | "phone" | "email" | "timezone" | "is_primary" | "is_active">
>;
export type DepartmentInput = Required<
  Pick<
    DepartmentRecord,
    "name" | "code" | "department_type" | "campus_id" | "description" | "is_active"
  >
>;
export type HouseInput = Required<
  Pick<HouseRecord, "name" | "code" | "color" | "motto" | "is_active">
>;

/** One page of a structure list (`/campuses`, `/departments`, `/houses`). */
export interface StructurePageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  isActive?: boolean;
  /** Departments only. */
  campusId?: string;
  /** Departments only. */
  departmentType?: DepartmentType;
}
