import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import {
  DEPARTMENT_ID,
  STAFF_ID,
  STAFF_ROW_ID,
  staffRecord,
  staffRegisterEntry,
} from "./staff-attendance-fixtures";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("staff-attendance-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads a date's staff register, with no department unless one is named", async () => {
    const { fetchStaffRegister } = await import("../staff-attendance-service");
    const entry = staffRegisterEntry({ record: staffRecord() });
    mockGet.mockResolvedValue({ data: [entry], meta: { date: "2026-10-23" } });

    const entries = await fetchStaffRegister({ date: "2026-10-23" });

    expect(mockGet).toHaveBeenCalledWith("/staff-attendance/register", {
      query: { date: "2026-10-23" },
    });
    expect(entries).toEqual([entry]);
  });

  it("narrows the register to a department", async () => {
    const { fetchStaffRegister } = await import("../staff-attendance-service");
    mockGet.mockResolvedValue({ data: [], meta: { date: "2026-10-23" } });

    await fetchStaffRegister({ date: "2026-10-23", departmentId: DEPARTMENT_ID });

    expect(mockGet).toHaveBeenCalledWith("/staff-attendance/register", {
      query: { date: "2026-10-23", department_id: DEPARTMENT_ID },
    });
  });

  it("pages the history by cursor with its filters", async () => {
    const { fetchStaffAttendancePage } = await import("../staff-attendance-service");
    mockGet.mockResolvedValue({
      data: [staffRecord()],
      meta: { pagination: { next_cursor: "n2", previous_cursor: null, page_size: 25 } },
    });

    const page = await fetchStaffAttendancePage({
      cursor: "c1",
      pageSize: 25,
      ordering: "-attendance_date",
      status: "late",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });

    expect(page.items).toEqual([staffRecord()]);
    expect(page.pagination).toMatchObject({ next_cursor: "n2" });
    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/staff-attendance");
    expect(options.query).toEqual({
      cursor: "c1",
      page_size: 25,
      ordering: "-attendance_date",
      status: "late",
      date__gte: "2026-10-01",
      date__lte: "2026-10-31",
    });
  });

  it("marks a staff day with every key, a blank one as null", async () => {
    const { markStaffAttendance } = await import("../staff-attendance-service");
    const written = staffRecord({ status: "late", check_in_time: "08:40:00", late_minutes: 40 });
    mockPost.mockResolvedValue({ data: written });

    const record = await markStaffAttendance({
      staffId: STAFF_ID,
      attendanceDate: "2026-10-23",
      status: "late",
      checkInTime: "08:40",
      checkOutTime: null,
      remarks: null,
    });

    expect(mockPost).toHaveBeenCalledWith("/staff-attendance", {
      staff_id: STAFF_ID,
      attendance_date: "2026-10-23",
      status: "late",
      check_in_time: "08:40",
      check_out_time: null,
      remarks: null,
    });
    expect(record).toEqual(written);
  });

  it("checks a staff member out on the colon-action", async () => {
    const { checkOutStaff } = await import("../staff-attendance-service");
    const written = staffRecord({ check_out_time: "16:30:00", early_departure_minutes: 0 });
    mockPost.mockResolvedValue({ data: written });

    const record = await checkOutStaff(STAFF_ROW_ID, "16:30");

    expect(mockPost).toHaveBeenCalledWith(`/staff-attendance/${STAFF_ROW_ID}:check-out`, {
      check_out_time: "16:30",
    });
    expect(record).toEqual(written);
  });
});
