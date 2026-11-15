import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  AcademicSessionSummary,
  DepartmentType,
  StructurePageQuery,
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

// --- The school calendar (`/holiday-calendar`, `apps/school_organization/calendar.py`) -----

export const HOLIDAY_CALENDAR_RESOURCE = "holiday-calendar";

/** Weekday numbers as the calendar stores them, 0 = Monday. */
export const CALENDAR_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** `HolidayEntrySerializer.name`. */
export const HOLIDAY_NAME_MAX = 120;

/** The fields the holiday dialog has an input for; a server error on one lands under it. */
export const HOLIDAY_ERROR_FIELDS = ["name", "start_date", "end_date", "campus_id"] as const;
