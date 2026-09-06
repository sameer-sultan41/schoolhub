import { id } from "@/data/factories";
import { fail, ok, pagedList } from "../envelope";
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

export interface SchoolOrganizationOptions {
  campuses?: Campus[];
  departments?: Department[];
}

/**
 * `/campuses`, `/departments` and friends.
 *
 * New modules get a sibling file here; nothing else changes. A spec opts in with
 * `mockApi.use(schoolOrganizationModule({ campuses }))`.
 */
export function schoolOrganizationModule(options: SchoolOrganizationOptions = {}): MockModule {
  return (api) => {
    const campuses = [...(options.campuses ?? [buildCampus()])];
    const departments = [...(options.departments ?? [buildDepartment()])];

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
  };
}
