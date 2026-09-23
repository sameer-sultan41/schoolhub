import { id } from "@/data/factories";
import { fail, ok, pagedList } from "../envelope";
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
 * `/staff` (list, detail, create, partial update, `:exit`) and `/designations` — see
 * docs/03-modules/staff-management.md §16.
 *
 * A spec opts in with `mockApi.use(staffModule({ staff }))`. Mirrors
 * `schoolOrganizationModule`'s shape exactly.
 */
export function staffModule(options: StaffOptions = {}): MockModule {
  return (api) => {
    const staff = [...(options.staff ?? [])];
    const designations = [...(options.designations ?? [buildDesignation()])];

    // Pages server-side, because that is where paging happens: `/staff` returns page
    // numbers now (api-architecture.md §2.4), and the dashboard is deliberately dumb
    // about it — it sends `?page=` and renders whatever comes back. A stub that
    // returned the whole list whatever the page asked for would let a broken pager
    // pass, which is the one thing a numbered-paging spec exists to catch.
    api.get("/staff", (request) => {
      const matching = filterAndOrder(staff, request.searchParams);
      const pageSize = Number(request.searchParams.get("page_size") ?? matching.length) || 1;
      const page = Number(request.searchParams.get("page") ?? 1) || 1;
      const start = (page - 1) * pageSize;
      return pagedList(matching.slice(start, start + pageSize), {
        page,
        page_size: pageSize,
        total_count: matching.length,
      });
    });

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

    // A plain `ModelViewSet` partial update: whatever the body names is what changes.
    api.patch("/staff/:staffId", (request) => {
      const match = staff.find((member) => member.id === request.params["staffId"]);
      if (!match) return fail(404, "Not found.");
      const body = (request.json() as Partial<Staff> | null) ?? {};
      Object.assign(match, body, { updated_at: "2026-09-02T00:00:00Z" });
      return ok(match);
    });

    // `POST /staff/{id}:exit` is a colon-action, and `:exit` would read as a second route
    // param here — so the whole `{id}:exit` segment is captured and split instead.
    api.post("/staff/:staffAction", (request) => {
      const [staffId, action] = (request.params["staffAction"] ?? "").split(":");
      const match = staff.find((member) => member.id === staffId);
      if (action !== "exit" || !match) return fail(404, "Not found.");
      if (match.exit_date !== null) {
        return fail(422, "This staff member has already exited.", {
          code: "domain_rule_violation",
        });
      }
      const body = (request.json() as ExitBody | null) ?? {};
      Object.assign(match, {
        employment_status: body.exit_type ?? "resigned",
        exit_date: body.exit_date ?? null,
        exit_reason: body.exit_reason ?? null,
        updated_at: "2026-09-02T00:00:00Z",
      });
      return ok(match);
    });

    api.get("/designations", () => pagedList(designations));
  };
}

interface ExitBody {
  exit_date?: string;
  exit_reason?: string;
  exit_type?: "resigned" | "retired" | "terminated";
}

/**
 * The subset of `/staff`'s real filters the dashboard sends: `StaffFilterSet`'s exact
 * `employment_status`/`staff_type`, `SearchFilter` on the name, and `OrderingFilter`
 * (`-` for descending). Honouring them matters here: the directory defaults to
 * `employment_status=active`, so an exited member dropping out of it is only observable
 * if the stub filters the way the server does.
 */
function filterAndOrder(staff: Staff[], params: URLSearchParams): Staff[] {
  const status = params.get("employment_status");
  const staffType = params.get("staff_type");
  const search = params.get("search")?.toLowerCase();
  const ordering = params.get("ordering");

  const matching = staff.filter(
    (member) =>
      (!status || member.employment_status === status) &&
      (!staffType || member.staff_type === staffType) &&
      (!search || `${member.first_name} ${member.last_name}`.toLowerCase().includes(search)),
  );
  if (!ordering) return matching;

  const descending = ordering.startsWith("-");
  const field = (descending ? ordering.slice(1) : ordering) as keyof Staff;
  return [...matching].sort((a, b) => {
    const order = String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
    return descending ? -order : order;
  });
}
