import { id } from "@/data/factories";
import { fail, ok, pagedList, paginated } from "../envelope";
import type { MockModule } from "../router";

/** Trimmed to the fields the dashboard reads; extend as the UI grows. */
export interface Campus {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  is_primary: boolean;
  is_active: boolean;
}

export function buildCampus(overrides: Partial<Campus> = {}): Campus {
  return {
    id: id("campus"),
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

/** Trimmed to the fields the staff feature reads (staff-form.tsx, staff-table.tsx). */
export interface Department {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export function buildDepartment(overrides: Partial<Department> = {}): Department {
  return {
    id: id("department"),
    name: "Science",
    code: "SCI",
    is_active: true,
    ...overrides,
  };
}

/** Trimmed to the fields the students feature reads (house select/filter). */
export interface House {
  id: string;
  name: string;
}

export function buildHouse(overrides: Partial<House> = {}): House {
  return {
    id: id("house"),
    name: "Red House",
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
    id: id("class"),
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
    id: id("section"),
    name: "A",
    class_id: "",
    campus_id: "",
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
    id: id("session"),
    name: "2026-27",
    status: "active",
    is_current: true,
    ...overrides,
  };
}

export interface SchoolOrganizationOptions {
  campuses?: Campus[];
  departments?: Department[];
  houses?: House[];
  classes?: SchoolClass[];
  sections?: Section[];
  academicSessions?: AcademicSession[];
}

/**
 * `/campuses`, `/departments`, `/houses` and friends.
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
    const academicSessions = [...(options.academicSessions ?? [])];

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

    api.get("/academic-sessions", () => paginated(academicSessions));

    api.get("/campuses", () => pagedList(campuses));

    api.get("/campuses/:campusId", (request) => {
      const match = campuses.find((campus) => campus.id === request.params["campusId"]);
      // Cross-tenant and non-existent rows are indistinguishable by design: the API
      // returns 404, never 403, so a probe cannot confirm a record exists elsewhere.
      return match ? ok(match) : fail(404, "Not found.");
    });

    api.post("/campuses", (request) => {
      const body = (request.json() as Partial<Campus> | null) ?? {};
      if (!body.name?.trim()) {
        return fail(400, "Validation failed.", {
          details: [{ field: "name", issue: "This field is required." }],
        });
      }
      // id last: the server assigns it, so a client-supplied one must not win.
      const created = buildCampus({ ...body, is_primary: false, id: id("campus") });
      campuses.push(created);
      return ok(created, { status: 201 });
    });

    api.get("/departments", () => pagedList(departments));

    api.get("/houses", () => pagedList(houses));
  };
}
