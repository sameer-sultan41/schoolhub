import { uuid } from "@/data/factories";
import { fail, ok } from "../envelope";
import { cursorPageOf, ordered, pageOf } from "../list";
import type { MockModule } from "../router";
import {
  buildHolidayCalendar,
  buildSchoolSettings,
  registerSchoolSetup,
  type HolidayCalendar,
  type SchoolSettings,
} from "./school-setup";
import { registerSchoolStructure } from "./school-structure";

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

/** The generated `Class` wire shape, less the timestamps. `level` orders the promotion ladder;
 * specs that only pick a class by name leave it at the default. */
export interface SchoolClass {
  id: string;
  name: string;
  code: string | null;
  level: number;
  is_active: boolean;
}

export function buildSchoolClass(overrides: Partial<SchoolClass> = {}): SchoolClass {
  return {
    id: uuid(),
    name: "Grade 1",
    code: null,
    level: 1,
    is_active: true,
    ...overrides,
  };
}

/** The generated `Section` wire shape, less the class teacher, the room and the timestamps.
 * A null capacity is unlimited. */
export interface Section {
  id: string;
  name: string;
  class_id: string;
  campus_id: string;
  capacity: number | null;
  is_active: boolean;
}

export function buildSection(overrides: Partial<Section> = {}): Section {
  return {
    id: uuid(),
    name: "A",
    class_id: "",
    campus_id: "",
    capacity: null,
    is_active: true,
    ...overrides,
  };
}

/** The generated `Subject` wire shape, less the timestamps. */
export interface Subject {
  id: string;
  name: string;
  code: string;
  subject_type: "core" | "elective" | "co_curricular";
  /** Null belongs to no department. */
  department_id: string | null;
  description: string | null;
  is_active: boolean;
}

export function buildSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: uuid(),
    name: "Mathematics",
    code: "MATH",
    subject_type: "core",
    department_id: null,
    description: null,
    is_active: true,
    ...overrides,
  };
}

/** The generated `AcademicSession` wire shape, less the timestamps. */
export interface AcademicSession {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "planned" | "active" | "closed" | "archived";
  is_current: boolean;
}

export function buildAcademicSession(overrides: Partial<AcademicSession> = {}): AcademicSession {
  return {
    id: uuid(),
    name: "2026-27",
    start_date: "2026-04-01",
    end_date: "2027-03-31",
    status: "active",
    is_current: true,
    ...overrides,
  };
}

/** The generated `Term` wire shape, less the timestamps. */
export interface Term {
  id: string;
  academic_session_id: string;
  name: string;
  sequence: number;
  start_date: string;
  end_date: string;
}

export function buildTerm(overrides: Partial<Term> = {}): Term {
  return {
    id: uuid(),
    academic_session_id: "",
    name: "Term 1",
    sequence: 1,
    start_date: "2026-04-01",
    end_date: "2026-09-30",
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
 * `/school-settings` and `/holiday-calendar` (`./school-setup.ts`), and the sessions, terms,
 * classes, sections and subjects writes (`./school-structure.ts`) over the same lists.
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

    api.get("/classes", (request) => structureList(classes, request.searchParams));

    // One class's sections (the School module's class rows and every section picker).
    api.get("/sections", (request) => {
      const params = request.searchParams;
      const classId = params.get("class_id");
      const campusId = params.get("campus_id");
      const isActive = params.get("is_active");
      const rows = sections.filter(
        (s) =>
          (!classId || s.class_id === classId) &&
          (!campusId || s.campus_id === campusId) &&
          (isActive === null || String(s.is_active) === isActive),
      );
      return pageOf(rows, params);
    });

    api.get("/subjects", (request) => {
      const params = request.searchParams;
      const departmentId = params.get("department_id");
      const type = params.get("subject_type");
      return structureList(
        subjects,
        params,
        (row) =>
          (!departmentId || row.department_id === departmentId) &&
          (!type || row.subject_type === type),
      );
    });

    // Cursor paged, as the API's default paginator; newest first unless the client orders.
    api.get("/academic-sessions", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const status = params.get("status");
      const matching = academicSessions.filter(
        (session) =>
          (!search || session.name.toLowerCase().includes(search)) &&
          (!status || session.status === status),
      );
      return cursorPageOf(ordered(matching, params.get("ordering") ?? "-start_date"), params);
    });

    // A session's terms, in their order: the exam form's term select and the School module's
    // session rows read them.
    api.get("/terms", (request) => {
      const params = request.searchParams;
      const sessionId = params.get("academic_session_id");
      const matching = terms.filter((term) => !sessionId || term.academic_session_id === sessionId);
      return cursorPageOf(ordered(matching, "sequence"), params);
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
    registerSchoolStructure(api, {
      campuses,
      classes,
      sections,
      subjects,
      academicSessions,
      terms,
    });
  };
}
