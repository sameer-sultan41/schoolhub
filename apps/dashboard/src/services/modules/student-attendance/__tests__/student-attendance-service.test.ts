import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import {
  attendanceRecord,
  myRegister,
  PERIOD_ID,
  registerEntry,
  registerMetaWire,
  SECTION_ID,
  STUDENT_ID,
} from "./student-attendance-fixtures";

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

describe("student-attendance-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads a register with its roster and meta, sending no period in daily mode", async () => {
    const { fetchRegister } = await import("../student-attendance-service");
    const entry = registerEntry();
    mockGet.mockResolvedValue({ data: [entry], meta: registerMetaWire() });

    const register = await fetchRegister({ sectionId: SECTION_ID, date: "2026-10-23" });

    expect(mockGet).toHaveBeenCalledWith("/student-attendance/register", {
      query: { section_id: SECTION_ID, date: "2026-10-23" },
    });
    expect(register.entries).toEqual([entry]);
    expect(register.meta).toMatchObject({ attendanceMode: "daily", markable: true });
  });

  it("names the period when a period register is read", async () => {
    const { fetchRegister } = await import("../student-attendance-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: registerMetaWire({ attendance_mode: "period" }),
    });

    const register = await fetchRegister({
      sectionId: SECTION_ID,
      date: "2026-10-23",
      periodId: PERIOD_ID,
    });

    expect(mockGet).toHaveBeenCalledWith("/student-attendance/register", {
      query: { section_id: SECTION_ID, date: "2026-10-23", period_id: PERIOD_ID },
    });
    expect(register.meta.attendanceMode).toBe("period");
  });

  it("lists the caller's registers for one date", async () => {
    const { fetchMyRegisters } = await import("../student-attendance-service");
    mockGet.mockResolvedValue({
      data: [myRegister()],
      meta: { attendance_mode: "daily", date: "2026-10-23" },
    });

    const result = await fetchMyRegisters("2026-10-23");

    expect(mockGet).toHaveBeenCalledWith("/student-attendance/my-registers", {
      query: { date: "2026-10-23" },
    });
    expect(result).toEqual({ registers: [myRegister()], attendanceMode: "daily" });
  });

  it("reads the tenant's mode from the my-registers meta", async () => {
    const { fetchMyRegisters } = await import("../student-attendance-service");
    mockGet.mockResolvedValue({
      data: [myRegister({ period_id: PERIOD_ID, period_name: "Period 1" })],
      meta: { attendance_mode: "period", date: "2026-10-23" },
    });

    const result = await fetchMyRegisters("2026-10-23");

    expect(result.attendanceMode).toBe("period");
  });

  it("pages the records by cursor with its filters", async () => {
    const { fetchAttendancePage } = await import("../student-attendance-service");
    mockGet.mockResolvedValue({
      data: [attendanceRecord()],
      meta: { pagination: { next_cursor: "n2", previous_cursor: null, page_size: 25 } },
    });

    const page = await fetchAttendancePage({
      cursor: "c1",
      pageSize: 25,
      status: "late",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });

    expect(page.items).toEqual([attendanceRecord()]);
    expect(page.pagination).toMatchObject({ next_cursor: "n2" });
    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/student-attendance");
    expect(options.query).toMatchObject({
      cursor: "c1",
      page_size: 25,
      status: "late",
      date__gte: "2026-10-01",
      date__lte: "2026-10-31",
    });
  });

  it("submits a register on the colon-action with the idempotency key", async () => {
    const { bulkMark } = await import("../student-attendance-service");
    mockPost.mockResolvedValue({
      data: [attendanceRecord()],
      meta: { marked: 1, updated: 0, alerts_queued: 2 },
    });

    const result = await bulkMark(
      {
        sectionId: SECTION_ID,
        attendanceDate: "2026-10-23",
        periodId: null,
        entries: [{ studentId: STUDENT_ID, status: "absent", remarks: "Called in sick" }],
      },
      "key-1",
    );

    expect(mockPost).toHaveBeenCalledWith(
      "/student-attendance:bulk-mark",
      {
        section_id: SECTION_ID,
        attendance_date: "2026-10-23",
        period_id: null,
        entries: [{ student_id: STUDENT_ID, status: "absent", remarks: "Called in sick" }],
      },
      { idempotencyKey: "key-1" },
    );
    expect(result).toEqual({
      records: [attendanceRecord()],
      meta: { marked: 1, updated: 0, alertsQueued: 2 },
    });
  });
});
