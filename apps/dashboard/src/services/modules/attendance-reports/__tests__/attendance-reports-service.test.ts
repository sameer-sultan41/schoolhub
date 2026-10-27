import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import {
  ACCEPTED,
  defaulterRow,
  JOB_ID,
  PERIOD_ID,
  SECTION_ID,
} from "./attendance-reports-fixtures";

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

describe("attendance-reports-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("runs a report inline, sending only the parameters it was given", async () => {
    const { runReport } = await import("../attendance-reports-service");
    const row = defaulterRow();
    mockGet.mockResolvedValue({
      data: [row],
      meta: { kind: "defaulters", row_count: 1, attendance_mode: "daily" },
      status: 200,
    });

    const run = await runReport({
      kind: "defaulters",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      sectionId: SECTION_ID,
      threshold: "90",
    });

    expect(mockGet).toHaveBeenCalledWith("/reports/attendance-summary", {
      query: {
        kind: "defaulters",
        start_date: "2026-10-01",
        end_date: "2026-10-31",
        section_id: SECTION_ID,
        threshold: "90",
      },
    });
    expect(run).toEqual({ kind: "defaulters", rows: [row], attendanceMode: "daily" });
  });

  it("carries the tenant's mode from the report's meta", async () => {
    const { runReport } = await import("../attendance-reports-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { kind: "daily-register", row_count: 0, attendance_mode: "period" },
      status: 200,
    });

    const run = await runReport({ kind: "daily-register", startDate: "2026-10-23" });

    expect(run).toEqual({ kind: "daily-register", rows: [], attendanceMode: "period" });
  });

  it("hands back the job when the report is too large to return inline", async () => {
    const { runReport } = await import("../attendance-reports-service");
    mockGet.mockResolvedValue({
      data: ACCEPTED,
      meta: { message: "Report queued: too many rows to return inline." },
      status: 202,
    });

    const run = await runReport({ kind: "daily-register", startDate: "2026-10-23" });

    expect(mockGet).toHaveBeenCalledWith("/reports/attendance-summary", {
      query: { kind: "daily-register", start_date: "2026-10-23" },
    });
    expect(run).toEqual({ jobId: JOB_ID });
  });

  it("exports with the report's parameters and a format, answering with the job", async () => {
    const { exportReport } = await import("../attendance-reports-service");
    mockPost.mockResolvedValue({
      data: ACCEPTED,
      meta: { message: "Report queued: export requested." },
      status: 202,
    });

    const accepted = await exportReport(
      {
        kind: "daily-register",
        startDate: "2026-10-23",
        sectionId: SECTION_ID,
        periodId: PERIOD_ID,
      },
      "xlsx",
    );

    expect(mockPost).toHaveBeenCalledWith("/reports/attendance-summary", {
      kind: "daily-register",
      start_date: "2026-10-23",
      section_id: SECTION_ID,
      period_id: PERIOD_ID,
      format: "xlsx",
    });
    expect(accepted).toEqual({ jobId: JOB_ID });
  });
});
