import { id } from "@/data/factories";
import { fail, ok, paginated } from "../envelope";
import type { MockModule } from "../router";

/** Trimmed to the fields the dashboard reads (staff-types.ts's `StaffRecord`). */
export interface Staff {
  id: string;
  employee_number: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  gender: "male" | "female" | "other" | "unspecified";
  date_of_birth: string | null;
  photo_file_id: string | null;
  staff_type: "teaching" | "non_teaching";
  campus_id: string;
  campus_name: string;
  department_id: string | null;
  department_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  reports_to_staff_id: string | null;
  employment_type: "full_time" | "part_time" | "contract" | "visiting";
  employment_status: "active" | "on_leave" | "suspended" | "resigned" | "retired" | "terminated";
  joining_date: string;
  exit_date: string | null;
  exit_reason: string | null;
  email: string | null;
  phone: string;
  national_id: string | null;
  public_bio: string | null;
  address: null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function buildStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: id("staff"),
    employee_number: "EMP-0001",
    user_id: null,
    first_name: "Bilal",
    last_name: "Ahmed",
    gender: "male",
    date_of_birth: "1985-06-01",
    photo_file_id: null,
    staff_type: "teaching",
    campus_id: "campus-0001",
    campus_name: "Main Campus",
    department_id: null,
    department_name: null,
    designation_id: null,
    designation_name: null,
    reports_to_staff_id: null,
    employment_type: "full_time",
    employment_status: "active",
    joining_date: "2026-04-01",
    exit_date: null,
    exit_reason: null,
    email: "bilal@cityschool.test",
    phone: "+92 300 1234567",
    national_id: null,
    public_bio: null,
    address: null,
    custom_fields: {},
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

/** Trimmed to the fields `use-designations.ts` reads. */
export interface Designation {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  level: number | null;
  is_active: boolean;
}

export function buildDesignation(overrides: Partial<Designation> = {}): Designation {
  return {
    id: id("designation"),
    name: "Senior Teacher",
    code: "SR-TCH",
    description: null,
    level: 2,
    is_active: true,
    ...overrides,
  };
}

export interface StaffOptions {
  staff?: Staff[];
  designations?: Designation[];
}

/**
 * `/staff` and `/designations` — see docs/03-modules/staff-management.md §16.
 *
 * A spec opts in with `mockApi.use(staffModule({ staff }))`. Mirrors
 * `schoolOrganizationModule`'s shape exactly.
 */
export function staffModule(options: StaffOptions = {}): MockModule {
  return (api) => {
    const staff = [...(options.staff ?? [])];
    const designations = [...(options.designations ?? [buildDesignation()])];

    api.get("/staff", () => paginated(staff));

    api.get("/staff/:staffId", (request) => {
      const match = staff.find((member) => member.id === request.params["staffId"]);
      // Cross-tenant and non-existent rows are indistinguishable by design (§11).
      return match ? ok(match) : fail(404, "Not found.");
    });

    api.post("/staff", (request) => {
      const body = (request.json() as Partial<Staff> | null) ?? {};
      const missing = (
        ["first_name", "last_name", "staff_type", "campus_id", "joining_date", "phone"] as const
      ).filter((field) => !body[field]);
      if (missing.length > 0) {
        return fail(400, "Validation failed.", {
          details: missing.map((field) => ({ field, issue: "This field is required." })),
        });
      }
      // employee_number and id are server-assigned — a client-supplied value must not win.
      const created = buildStaff({
        ...body,
        id: id("staff"),
        employee_number: `EMP-${String(staff.length + 1).padStart(4, "0")}`,
      });
      staff.push(created);
      return ok(created, { status: 201 });
    });

    api.get("/designations", () => paginated(designations));
  };
}
