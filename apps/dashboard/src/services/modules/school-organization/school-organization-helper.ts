import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_DEPARTMENT_TYPE,
  STRUCTURE_QUERY_FIELDS,
  STRUCTURE_STATUS,
} from "./school-organization-constant";
import type {
  CampusFormValues,
  DepartmentFormValues,
  HolidayFormValues,
  HouseFormValues,
} from "./school-organization.schema";
import type {
  CampusInput,
  CampusRecord,
  DepartmentInput,
  DepartmentRecord,
  DepartmentType,
  HolidayEntry,
  HouseInput,
  HouseRecord,
  StructurePageQuery,
} from "./school-organization-type";

/** The school-organization module's pure helpers: plain data in, plain data out. */

export function toStructureQueryParams(
  query: StructurePageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(
    query,
    STRUCTURE_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/** The status filter -> `is_active`: `all` (or anything else) is no filter. */
export function structureStatusToIsActive(status: string): boolean | undefined {
  if (status === STRUCTURE_STATUS.active) return true;
  if (status === STRUCTURE_STATUS.inactive) return false;
  return undefined;
}

/** The type filter -> `department_type`: `all` is no filter. */
export function typeFilterToDepartmentType(type: string): DepartmentType | undefined {
  return type === FILTER_ALL ? undefined : (type as DepartmentType);
}

/** Trimmed, with a blank as `null`, which clears a stored value. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// --- Campuses -------------------------------------------------------------------------------

export function defaultCampusFormValues(): CampusFormValues {
  return {
    name: "",
    code: "",
    phone: "",
    email: "",
    timezone: "",
    is_primary: false,
    is_active: true,
  };
}

export function recordToCampusFormValues(record: CampusRecord): CampusFormValues {
  return {
    name: record.name,
    code: record.code,
    phone: record.phone ?? "",
    email: record.email ?? "",
    timezone: record.timezone ?? "",
    is_primary: record.is_primary ?? false,
    is_active: record.is_active ?? true,
  };
}

/** Every field is editable, so create and edit send the same body. A blank timezone is `null`:
 * the campus inherits the school's. */
export function buildCampusInput(values: CampusFormValues): CampusInput {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    phone: blankToNull(values.phone),
    email: blankToNull(values.email),
    timezone: blankToNull(values.timezone),
    is_primary: values.is_primary,
    is_active: values.is_active,
  };
}

// --- Departments ----------------------------------------------------------------------------

export function defaultDepartmentFormValues(): DepartmentFormValues {
  return {
    name: "",
    code: "",
    department_type: DEFAULT_DEPARTMENT_TYPE,
    campus_id: "",
    description: "",
    is_active: true,
  };
}

export function recordToDepartmentFormValues(record: DepartmentRecord): DepartmentFormValues {
  return {
    name: record.name,
    code: record.code,
    department_type: record.department_type ?? DEFAULT_DEPARTMENT_TYPE,
    campus_id: record.campus_id ?? "",
    description: record.description ?? "",
    is_active: record.is_active ?? true,
  };
}

/** A blank campus is `null`: the department spans every campus. */
export function buildDepartmentInput(values: DepartmentFormValues): DepartmentInput {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    department_type: values.department_type,
    campus_id: values.campus_id || null,
    description: blankToNull(values.description),
    is_active: values.is_active,
  };
}

// --- Houses ---------------------------------------------------------------------------------

export function defaultHouseFormValues(): HouseFormValues {
  return { name: "", code: "", color: "", motto: "", is_active: true };
}

export function recordToHouseFormValues(record: HouseRecord): HouseFormValues {
  return {
    name: record.name,
    code: record.code ?? "",
    color: record.color ?? "",
    motto: record.motto ?? "",
    is_active: record.is_active ?? true,
  };
}

export function buildHouseInput(values: HouseFormValues): HouseInput {
  return {
    name: values.name.trim(),
    code: blankToNull(values.code),
    color: blankToNull(values.color),
    motto: blankToNull(values.motto),
    is_active: values.is_active,
  };
}

// --- The school calendar --------------------------------------------------------------------

export function defaultHolidayFormValues(): HolidayFormValues {
  return { name: "", start_date: "", end_date: "", campus_id: "" };
}

/** A one-day holiday is stored with its end equal to its start; the form shows that as blank. */
export function holidayToFormValues(entry: HolidayEntry): HolidayFormValues {
  const endDate = entry.end_date ?? entry.start_date;
  return {
    name: entry.name,
    start_date: entry.start_date,
    end_date: endDate === entry.start_date ? "" : endDate,
    campus_id: entry.campus_id ?? "",
  };
}

/** A blank end is the start (the server defaults it the same way); a blank campus is every
 * campus. */
export function buildHolidayEntry(values: HolidayFormValues): HolidayEntry {
  return {
    name: values.name.trim(),
    start_date: values.start_date,
    end_date: values.end_date || values.start_date,
    campus_id: values.campus_id || null,
  };
}

/** `holidays` with the entry at `index` replaced by `entry`, or `entry` appended when `index`
 * is past the end (a new holiday). The `PUT` sends the whole list. */
export function withHoliday(
  holidays: readonly HolidayEntry[],
  index: number,
  entry: HolidayEntry,
): HolidayEntry[] {
  return index >= holidays.length
    ? [...holidays, entry]
    : holidays.map((current, at) => (at === index ? entry : current));
}

export function withoutHoliday(holidays: readonly HolidayEntry[], index: number): HolidayEntry[] {
  return holidays.filter((_, at) => at !== index);
}

/**
 * The server names a holiday's error by its place in the list: DRF's `ListField` keys a child's
 * errors by index, which the envelope flattens to `holidays.2.end_date`. The dialog edits one
 * entry, so the one at `index` maps onto its own input; anything else is left as it was and
 * shows as the form's message.
 */
export function holidayErrorField(index: number) {
  const prefix = `holidays.${String(index)}.`;
  return (field: string): string | undefined =>
    field.startsWith(prefix) ? field.slice(prefix.length) : undefined;
}

/** The holidays in date order, each with its place in the stored list, which edits address. */
export function holidaysByDate(
  holidays: readonly HolidayEntry[],
): { entry: HolidayEntry; index: number }[] {
  return holidays
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.start_date.localeCompare(b.entry.start_date) || a.index - b.index);
}
