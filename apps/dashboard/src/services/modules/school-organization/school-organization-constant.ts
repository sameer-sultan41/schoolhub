import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  AcademicSessionStatus,
  AcademicSessionSummary,
  DepartmentType,
  SessionPageQuery,
  StructurePageQuery,
  SubjectType,
} from "./school-organization-type";

/** Session statuses that make its records read-only — mirrors `LOCKED_SESSION_STATES`
 * (`apps/api/apps/school_organization/services.py`); the API refuses the write either way. */
export const LOCKED_SESSION_STATUSES: readonly AcademicSessionSummary["status"][] = [
  "closed",
  "archived",
];

// --- Shared by the School module's structure lists -----------------------------------------

/** The query-key module every school-organization read lives under, the reference lists other
 * screens pick from included, so a structure write refreshes those pickers too. */
export const SCHOOL_ORGANIZATION_QUERY_MODULE = "school-organization";

/** The status filter: `all` omits the API filter, the others map to `is_active`. */
export const STRUCTURE_STATUS = {
  all: FILTER_ALL,
  active: "active",
  inactive: "inactive",
} as const;
const STRUCTURE_STATUS_VALUES: readonly string[] = Object.values(STRUCTURE_STATUS);
const STATUS_URL_FILTER = {
  default: STRUCTURE_STATUS.all,
  isValid: (value: string) => STRUCTURE_STATUS_VALUES.includes(value),
};

/** The campus picker's choice for "every campus" (stored as a blank, sent as `null`): a
 * `SelectItem` cannot carry the blank itself. */
export const ALL_CAMPUSES_OPTION = FILTER_ALL;

/** The table's `actions` column id: hidden for a viewer with neither action. */
export const STRUCTURE_ACTIONS_COLUMN_ID = "actions";

/** A camelCase `StructurePageQuery` key and the list endpoints' query param for it. */
type StructureQueryField = readonly [keyof StructurePageQuery, string];

export const STRUCTURE_QUERY_FIELDS: readonly StructureQueryField[] = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["isActive", "is_active"],
  ["campusId", "campus_id"],
  ["departmentType", "department_type"],
  ["departmentId", "department_id"],
  ["subjectType", "subject_type"],
];

// --- Campuses (`apps/school_organization/models.py` `Campus`) -----------------------------

export const CAMPUS_PAGE_RESOURCE = "campus-page";

/** Column id -> the `?ordering=` field `/campuses` accepts (`CampusViewSet.ordering_fields`). */
export const CAMPUS_SORT_FIELD: Record<string, string> = {
  code: "code",
  name: "name",
  primary: "is_primary",
  status: "is_active",
};
export const CAMPUS_SORTABLE_IDS = Object.keys(CAMPUS_SORT_FIELD);
export const CAMPUS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "name", desc: false },
];
export const CAMPUS_URL_FILTERS = { status: STATUS_URL_FILTER };

export const CAMPUS_NAME_MAX = 150;
export const CAMPUS_CODE_MAX = 20;
export const CAMPUS_PHONE_MAX = 32;
export const CAMPUS_EMAIL_MAX = 254;
export const CAMPUS_TIMEZONE_MAX = 64;

export const CAMPUS_ERROR_FIELDS = [
  "name",
  "code",
  "phone",
  "email",
  "timezone",
  "is_primary",
  "is_active",
] as const;

// --- Departments (`Department`) ------------------------------------------------------------

export const DEPARTMENT_PAGE_RESOURCE = "department-page";

/** Every department type, keyed so the compiler checks the set against the generated enum. */
const DEPARTMENT_TYPE_SET: Record<DepartmentType, true> = { academic: true, administrative: true };
export const DEPARTMENT_TYPES = Object.keys(DEPARTMENT_TYPE_SET) as DepartmentType[];
/** The model's default. */
export const DEFAULT_DEPARTMENT_TYPE: DepartmentType = "academic";
const DEPARTMENT_TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...DEPARTMENT_TYPES];

/** Column id -> `?ordering=` field (`DepartmentViewSet.ordering_fields`). */
export const DEPARTMENT_SORT_FIELD: Record<string, string> = {
  code: "code",
  name: "name",
  type: "department_type",
  campus: "campus_name",
};
export const DEPARTMENT_SORTABLE_IDS = Object.keys(DEPARTMENT_SORT_FIELD);
export const DEPARTMENT_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "name", desc: false },
];
export const DEPARTMENT_URL_FILTERS = {
  campus: { default: "", isValid: isUuid },
  type: {
    default: FILTER_ALL,
    isValid: (value: string) => DEPARTMENT_TYPE_FILTER_VALUES.includes(value),
  },
  status: STATUS_URL_FILTER,
};

export const DEPARTMENT_NAME_MAX = 150;
export const DEPARTMENT_CODE_MAX = 20;
export const DEPARTMENT_DESCRIPTION_MAX = 300;

export const DEPARTMENT_ERROR_FIELDS = [
  "name",
  "code",
  "department_type",
  "campus_id",
  "description",
  "is_active",
] as const;

// --- Houses (`House`) ----------------------------------------------------------------------

export const HOUSE_PAGE_RESOURCE = "house-page";

/** Column id -> `?ordering=` field (`HouseViewSet.ordering_fields`). */
export const HOUSE_SORT_FIELD: Record<string, string> = { name: "name", code: "code" };
export const HOUSE_SORTABLE_IDS = Object.keys(HOUSE_SORT_FIELD);
export const HOUSE_DEFAULT_SORTING: { id: string; desc: boolean }[] = [{ id: "name", desc: false }];
export const HOUSE_URL_FILTERS = { status: STATUS_URL_FILTER };

export const HOUSE_NAME_MAX = 80;
export const HOUSE_CODE_MAX = 20;
export const HOUSE_COLOR_MAX = 20;
export const HOUSE_MOTTO_MAX = 200;

export const HOUSE_ERROR_FIELDS = ["name", "code", "color", "motto", "is_active"] as const;

// --- Classes and their sections (`Class`, `Section`) ---------------------------------------

export const CLASS_PAGE_RESOURCE = "class-page";
/** One class's sections, in full (`fetchClassSections`), apart from the pickers' options. */
export const CLASS_SECTIONS_RESOURCE = "class-sections";

/** Column id -> `?ordering=` field (`ClassViewSet.ordering_fields`). */
export const CLASS_SORT_FIELD: Record<string, string> = {
  level: "level",
  name: "name",
  code: "code",
};
export const CLASS_SORTABLE_IDS = Object.keys(CLASS_SORT_FIELD);
/** The promotion ladder, lowest first, as the API orders classes. */
export const CLASS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "level", desc: false },
];
export const CLASS_URL_FILTERS = { status: STATUS_URL_FILTER };

/** The column whose expanded row lists the class's sections. */
export const CLASS_SECTIONS_COLUMN_ID = "sections";

/** `Class.name`, `Class.code` and `Section.name`. */
export const CLASS_NAME_MAX = 80;
export const CLASS_CODE_MAX = 20;
export const SECTION_NAME_MAX = 30;

export const CLASS_ERROR_FIELDS = ["name", "code", "level", "is_active"] as const;
export const SECTION_ERROR_FIELDS = [
  "class_id",
  "campus_id",
  "name",
  "capacity",
  "is_active",
] as const;

// --- Subjects (`Subject`) ------------------------------------------------------------------

export const SUBJECT_PAGE_RESOURCE = "subject-page";

/** Every subject type, keyed so the compiler checks the set against the generated enum. */
const SUBJECT_TYPE_SET: Record<SubjectType, true> = {
  core: true,
  elective: true,
  co_curricular: true,
};
export const SUBJECT_TYPES = Object.keys(SUBJECT_TYPE_SET) as SubjectType[];
/** The model's default. */
export const DEFAULT_SUBJECT_TYPE: SubjectType = "core";
const SUBJECT_TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...SUBJECT_TYPES];

/** The department picker's choice for "no department" (stored as a blank, sent as `null`). */
export const NO_DEPARTMENT_OPTION = FILTER_ALL;

/** Column id -> `?ordering=` field (`SubjectViewSet.ordering_fields`). */
export const SUBJECT_SORT_FIELD: Record<string, string> = {
  code: "code",
  name: "name",
  department: "department_name",
};
export const SUBJECT_SORTABLE_IDS = Object.keys(SUBJECT_SORT_FIELD);
export const SUBJECT_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "name", desc: false },
];
export const SUBJECT_URL_FILTERS = {
  department: { default: "", isValid: isUuid },
  type: {
    default: FILTER_ALL,
    isValid: (value: string) => SUBJECT_TYPE_FILTER_VALUES.includes(value),
  },
  status: STATUS_URL_FILTER,
};

/** `Subject.name`, `.code` and `.description`. */
export const SUBJECT_NAME_MAX = 120;
export const SUBJECT_CODE_MAX = 20;
export const SUBJECT_DESCRIPTION_MAX = 300;

export const SUBJECT_ERROR_FIELDS = [
  "name",
  "code",
  "subject_type",
  "department_id",
  "description",
  "is_active",
] as const;

// --- Academic sessions and terms (`AcademicSession`, `Term`) -------------------------------

export const SESSION_PAGE_RESOURCE = "session-page";
/** `/academic-sessions` pages by cursor (the API's default paginator). */
export const SESSION_PAGE_SIZE = 25;

/** Every session status, keyed so the compiler checks the set against the generated enum. */
const SESSION_STATUS_SET: Record<AcademicSessionStatus, true> = {
  planned: true,
  active: true,
  closed: true,
  archived: true,
};
export const SESSION_STATUSES = Object.keys(SESSION_STATUS_SET) as AcademicSessionStatus[];
const SESSION_STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...SESSION_STATUSES];

/** Column id -> `?ordering=` field (`AcademicSessionViewSet.ordering_fields`). */
export const SESSION_SORT_FIELD: Record<string, string> = { name: "name", dates: "start_date" };
export const SESSION_SORTABLE_IDS = Object.keys(SESSION_SORT_FIELD);
/** Newest year first, as the model orders them. */
export const SESSION_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "dates", desc: true },
];
export const SESSION_URL_FILTERS = {
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => SESSION_STATUS_FILTER_VALUES.includes(value),
  },
};

/** A camelCase `SessionPageQuery` key and `/academic-sessions`' query param for it. */
export const SESSION_QUERY_FIELDS: ReadonlyArray<readonly [keyof SessionPageQuery, string]> = [
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["status", "status"],
];

/** The column whose expanded row lists the session's terms. */
export const SESSION_TERMS_COLUMN_ID = "terms";

/** `AcademicSession.name` and `Term.name`. */
export const SESSION_NAME_MAX = 50;
export const TERM_NAME_MAX = 50;

/** The fields the session and clone dialogs have an input for. */
export const SESSION_ERROR_FIELDS = ["name", "start_date", "end_date"] as const;
export const TERM_ERROR_FIELDS = ["name", "sequence", "start_date", "end_date"] as const;

/** The envelope field the activation check's gaps come back under (`{structure: [...]}`). */
export const SESSION_STRUCTURE_FIELD = "structure";

// --- The school calendar (`/holiday-calendar`, `apps/school_organization/calendar.py`) -----

export const HOLIDAY_CALENDAR_RESOURCE = "holiday-calendar";

/** Weekday numbers as the calendar stores them, 0 = Monday. */
export const CALENDAR_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** `HolidayEntrySerializer.name`. */
export const HOLIDAY_NAME_MAX = 120;

/** The fields the holiday dialog has an input for; a server error on one lands under it. */
export const HOLIDAY_ERROR_FIELDS = ["name", "start_date", "end_date", "campus_id"] as const;
