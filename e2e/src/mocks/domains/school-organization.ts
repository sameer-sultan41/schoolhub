import { uuid } from "@/data/factories";
import { fail, ok, pagedList, paginated } from "../envelope";
import { ordered, pageOf } from "../list";
import type { MockModule } from "../router";
import {
  buildHolidayCalendar,
  buildSchoolSettings,
  registerSchoolSetup,
  type HolidayCalendar,
  type SchoolSettings,
} from "./school-setup";

/** The generated `Campus` wire shape, less the staff head and the timestamps nothing reads. */
export interface Campus {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Null inherits the school's timezone. */
  timezone: string | null;
  is_primary: boolean;
  is_active: boolean;
}

export function buildCampus(overrides: Partial<Campus> = {}): Campus {
  return {
    id: uuid(),
    name: "Main Campus",
    code: "MAIN",
    address: "12 Jinnah Road, Karachi",
    phone: "+92 21 1234567",
    email: "main@cityschool.test",
    timezone: "Asia/Karachi",
    is_primary: true,
    is_active: true,
    ...overrides,
  };
}

/** The generated `Department` wire shape, less the staff head and the timestamps. */
export interface Department {
  id: string;
  name: string;
  code: string;
  department_type: "academic" | "administrative";
  /** Null spans every campus. */
  campus_id: string | null;
  description: string | null;
  is_active: boolean;
}

export function buildDepartment(overrides: Partial<Department> = {}): Department {
  return {
    id: uuid(),
    name: "Science",
    code: "SCI",
    department_type: "academic",
    campus_id: null,
    description: null,
    is_active: true,
    ...overrides,
  };
}

/** The generated `House` wire shape, less the house master and the timestamps. */
export interface House {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
  motto: string | null;
  is_active: boolean;
}

export function buildHouse(overrides: Partial<House> = {}): House {
  return {
    id: uuid(),
    name: "Red House",
    code: "RED",
    color: "#D32F2F",
    motto: null,
    is_active: true,
    ...overrides,
  };
}

/** Trimmed to the fields `ClassSectionFields`/the directory filters read. Not the same
 * fixtures `dashboard-home.ts` registers for its own bare `/classes`/`/sections` count
 * stubs — a spec that needs real, named options composes this module instead. */
export interface SchoolClass {
  id: string;
  name: string;
  is_active: boolean;
}

export function buildSchoolClass(overrides: Partial<SchoolClass> = {}): SchoolClass {
  return {
    id: uuid(),
    name: "Grade 1",
    is_active: true,
    ...overrides,
  };
}

export interface Section {
  id: string;
  name: string;
  class_id: string;
  campus_id: string;
  is_active: boolean;
}

export function buildSection(overrides: Partial<Section> = {}): Section {
  return {
    id: uuid(),
    name: "A",
    class_id: "",
    campus_id: "",
    is_active: true,
    ...overrides,
  };
}

/** Trimmed to the fields the curriculum form's subject select reads. */
export interface Subject {
  id: string;
  name: string;
  is_active: boolean;
}

export function buildSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: uuid(),
    name: "Mathematics",
    is_active: true,
    ...overrides,
  };
}

export interface AcademicSession {
  id: string;
  name: string;
  status: "planned" | "active" | "closed" | "archived";
  is_current: boolean;
}

export function buildAcademicSession(overrides: Partial<AcademicSession> = {}): AcademicSession {
  return {
    id: uuid(),
    name: "2026-27",
    status: "active",
    is_current: true,
    ...overrides,
  };
}

/** Trimmed to what a term picker reads: its name and its order. */
export interface Term {
  id: string;
  academic_session_id: string;
  name: string;
  sequence: number;
}

export function buildTerm(overrides: Partial<Term> = {}): Term {
  return {
    id: uuid(),
    academic_session_id: "",
    name: "Term 1",
    sequence: 1,
    ...overrides,
  };
}

export interface SchoolOrganizationOptions {
  campuses?: Campus[];
  departments?: Department[];
  houses?: House[];
  classes?: SchoolClass[];
  sections?: Section[];
  subjects?: Subject[];
  academicSessions?: AcademicSession[];
  terms?: Term[];
  settings?: SchoolSettings;
  calendar?: HolidayCalendar;
}

/**
 * A structure list's filters, search and sort, then one page of it. With no `?page=` (a
 * reference-data picker asking for `MAX_PAGE_SIZE`) it is the whole list in stored order.
 */
function structureList<T extends { name: string; code: string | null; is_active: boolean }>(
  rows: readonly T[],
  params: URLSearchParams,
  matches: (row: T) => boolean = () => true,
) {
  const isActive = params.get("is_active");
  const search = params.get("search")?.toLowerCase();
  const matching = rows.filter(
    (row) =>
      (isActive === null || String(row.is_active) === isActive) &&
      (!search || `${row.name} ${row.code ?? ""}`.toLowerCase().includes(search)) &&
      matches(row),
  );
  const ordering = params.get("ordering");
  return pageOf(ordering ? ordered(matching, ordering) : matching, params);
}

/**
 * `/campuses`, `/departments`, `/houses` and friends, with the School module's writes,
 * `/school-settings` and `/holiday-calendar` (`./school-setup.ts`) over the same lists.
 *
 * New modules get a sibling file here; nothing else changes. A spec opts in with
 * `mockApi.use(schoolOrganizationModule({ campuses }))`.
 */
export function schoolOrganizationModule(options: SchoolOrganizationOptions = {}): MockModule {
  return (api) => {
    const campuses = [...(options.campuses ?? [buildCampus()])];
    const departments = [...(options.departments ?? [buildDepartment()])];
    const houses = [...(options.houses ?? [buildHouse()])];
    const classes = [...(options.classes ?? [])];
    const sections = [...(options.sections ?? [])];
    const subjects = [...(options.subjects ?? [])];
    const academicSessions = [...(options.academicSessions ?? [])];
    const terms = [...(options.terms ?? [])];
    const settings = { ...(options.settings ?? buildSchoolSettings()) };
    const calendar = { ...(options.calendar ?? buildHolidayCalendar()) };

    api.get("/classes", (request) => {
      const isActive = request.searchParams.get("is_active");
      const rows =
        isActive === null ? classes : classes.filter((c) => String(c.is_active) === isActive);
      return pagedList(rows);
    });

    api.get("/sections", (request) => {
      const classId = request.searchParams.get("class_id");
      const campusId = request.searchParams.get("campus_id");
      const isActive = request.searchParams.get("is_active");
      const rows = sections.filter(
        (s) =>
          (!classId || s.class_id === classId) &&
          (!campusId || s.campus_id === campusId) &&
          (isActive === null || String(s.is_active) === isActive),
      );
      return pagedList(rows);
    });

    api.get("/subjects", (request) => {
      const isActive = request.searchParams.get("is_active");
      const rows =
        isActive === null ? subjects : subjects.filter((s) => String(s.is_active) === isActive);
      return pagedList(rows);
    });

    api.get("/academic-sessions", () => paginated(academicSessions));

    // A session's terms: the exam form's term select reads them once a session is picked.
    api.get("/terms", (request) => {
      const sessionId = request.searchParams.get("academic_session_id");
      return paginated(
        terms.filter((term) => !sessionId || term.academic_session_id === sessionId),
      );
    });

    api.get("/campuses", (request) => structureList(campuses, request.searchParams));

    api.get("/campuses/:campusId", (request) => {
      const match = campuses.find((campus) => campus.id === request.params["campusId"]);
      // Cross-tenant and non-existent rows are indistinguishable by design: the API
      // returns 404, never 403, so a probe cannot confirm a record exists elsewhere.
      return match ? ok(match) : fail(404, "Not found.");
    });

    api.get("/departments", (request) => {
      const params = request.searchParams;
      const campusId = params.get("campus_id");
      const type = params.get("department_type");
      return structureList(
        departments,
        params,
        (row) =>
          (!campusId || row.campus_id === campusId) && (!type || row.department_type === type),
      );
    });

    api.get("/houses", (request) => structureList(houses, request.searchParams));

    registerSchoolSetup(api, { campuses, departments, houses, settings, calendar });
  };
}
