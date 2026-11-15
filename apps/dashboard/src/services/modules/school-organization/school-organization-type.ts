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

/** A term as `/terms` answers it: the School module lists its dates, and a picker reads its
 * name and order. */
export type TermRecord = ApiSchemas["Term"];

// The School module's structure screens: the generated wire shapes (ADR-0017).

export type CampusRecord = ApiSchemas["Campus"];
export type DepartmentRecord = ApiSchemas["Department"];
export type DepartmentType = ApiSchemas["DepartmentTypeEnum"];
export type HouseRecord = ApiSchemas["House"];
export type ClassRecord = ApiSchemas["Class"];
export type SectionRecord = ApiSchemas["Section"];
export type SubjectRecord = ApiSchemas["Subject"];
export type SubjectType = ApiSchemas["SubjectSubjectTypeEnum"];
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
export type ClassInput = Required<Pick<ClassRecord, "name" | "code" | "level" | "is_active">>;
/** A section's class teacher and room are not set from this form. */
export type SectionInput = Required<
  Pick<SectionRecord, "class_id" | "campus_id" | "name" | "capacity" | "is_active">
>;
export type SubjectInput = Required<
  Pick<
    SubjectRecord,
    "name" | "code" | "subject_type" | "department_id" | "description" | "is_active"
  >
>;

// Academic sessions and their terms (the School module's Sessions section).

export type AcademicSessionRecord = ApiSchemas["AcademicSession"];
export type AcademicSessionStatus = ApiSchemas["AcademicSessionStatusEnum"];
/** The body of a create or edit; the status moves only through `:activate` and `:close`. */
export type SessionInput = Pick<AcademicSessionRecord, "name" | "start_date" | "end_date">;
/** `POST /academic-sessions/{id}:clone`: the new session's name and dates. */
export type SessionCloneInput = ApiSchemas["SessionClone"];
/** A term's edit body; a new term also names its session. */
export type TermInput = Pick<TermRecord, "name" | "sequence" | "start_date" | "end_date">;
export type TermCreateInput = TermInput & Pick<TermRecord, "academic_session_id">;

/** One cursor page of `/academic-sessions`. */
export interface SessionPageQuery {
  cursor?: string;
  pageSize?: number;
  search?: string;
  ordering?: string;
  status?: AcademicSessionStatus;
}

/** One page of a structure list (`/campuses`, `/departments`, `/houses`, `/classes`,
 * `/subjects`). */
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
  /** Subjects only. */
  departmentId?: string;
  /** Subjects only. */
  subjectType?: SubjectType;
}
