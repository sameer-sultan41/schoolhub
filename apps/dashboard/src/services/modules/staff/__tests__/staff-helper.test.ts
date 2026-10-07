import {
  statusMeta,
  toStaffCreateBody,
  toStaffQueryParams,
  toStaffRow,
  toStaffUpdateBody,
} from "../staff-helper";
import type { CreateStaffInput, StaffDirectoryRecord } from "../staff-type";

function staffRecord(overrides: Partial<StaffDirectoryRecord> = {}): StaffDirectoryRecord {
  return {
    id: "st-1",
    first_name: "Ayesha",
    last_name: "Khan",
    designation_name: "Head Teacher",
    department_name: "Academics",
    campus_name: "Main Campus",
    staff_type: "teaching",
    employment_status: "active",
    updated_at: "2026-09-01T00:00:00Z",
    photo_url: null,
    ...overrides,
  };
}

describe("toStaffRow", () => {
  it("joins first and last name", () => {
    const row = toStaffRow(staffRecord());
    expect(row.name).toBe("Ayesha Khan");
  });

  it("falls back to a staff-type label when designation_name is absent", () => {
    const row = toStaffRow(staffRecord({ designation_name: null, staff_type: "non_teaching" }));
    expect(row.designation).toBe("Non-teaching staff");
  });

  it("falls back to the teaching-staff label when designation_name is absent", () => {
    const row = toStaffRow(staffRecord({ designation_name: null, staff_type: "teaching" }));
    expect(row.designation).toBe("Teaching staff");
  });
});

describe("statusMeta", () => {
  it("returns the known variant and label for a mapped status", () => {
    expect(statusMeta("active")).toEqual({ variant: "success", label: "Active" });
  });

  it("falls back to a secondary variant with a humanized label for an unmapped status", () => {
    expect(statusMeta("pending_review")).toEqual({
      variant: "secondary",
      label: "Pending review",
    });
  });
});

describe("toStaffCreateBody", () => {
  it("truthy-gates the required-like fields, omitting an empty one", () => {
    const body = toStaffCreateBody({
      firstName: "",
      lastName: "Khan",
    } as Partial<CreateStaffInput> as CreateStaffInput);
    expect(body).toEqual({ last_name: "Khan" });
  });

  // Root cause: createStaff used to truthy-gate its optional fields (an explicit
  // `null` for a nullable relation was silently dropped, unlike updateStaff's own
  // `!== undefined` gating for the identical field) — unified so create and update
  // agree on what "the caller explicitly cleared this field" means.
  it("sends an explicit null for a cleared optional relation field, not dropping it", () => {
    const body = toStaffCreateBody({
      departmentId: null,
    } as Partial<CreateStaffInput> as CreateStaffInput);
    expect(body).toEqual({ department_id: null });
  });

  it("omits an optional field left undefined", () => {
    const body = toStaffCreateBody({
      departmentId: undefined,
    } as Partial<CreateStaffInput> as CreateStaffInput);
    expect(body).toEqual({});
  });

  it("includes a truthy optional field", () => {
    const body = toStaffCreateBody({
      departmentId: "dept-1",
    } as Partial<CreateStaffInput> as CreateStaffInput);
    expect(body).toEqual({ department_id: "dept-1" });
  });
});

describe("toStaffUpdateBody", () => {
  it("truthy-gates the required-like fields, omitting an empty one", () => {
    const body = toStaffUpdateBody({ firstName: "", lastName: "Khan" });
    expect(body).toEqual({ last_name: "Khan" });
  });

  it("sends an explicit null for a cleared optional relation field", () => {
    const body = toStaffUpdateBody({ departmentId: null });
    expect(body).toEqual({ department_id: null });
  });

  it("omits an optional field left undefined", () => {
    const body = toStaffUpdateBody({ firstName: "Ayesha" });
    expect(body).toEqual({ first_name: "Ayesha" });
  });
});

describe("toStaffQueryParams", () => {
  it("includes only the truthy fields given", () => {
    const params = toStaffQueryParams({ pageSize: 1 });
    expect(params).toEqual({ page_size: 1 });
  });

  it("maps employmentStatus to employment_status", () => {
    const params = toStaffQueryParams({ page: 1, pageSize: 10, employmentStatus: "active" });
    expect(params).toEqual({ page: 1, page_size: 10, employment_status: "active" });
  });
});
