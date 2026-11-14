import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import {
  COLLECTION_DAY,
  STATEMENT_INVOICE,
  STATEMENT_PAYMENT,
  STUDENT_ID,
} from "./finance-reports-fixtures";

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
      downloadBlob: jest.fn(),
    })),
  };
});

const JOB_ID = "88888888-8888-4888-8888-888888888888";
const SESSION_ID = "99999999-9999-4999-8999-999999999999";

describe("finance-reports-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("fetchReport sends the kind, the dates and only the filters it was given", async () => {
    const { fetchReport } = await import("../finance-reports-service");
    mockGet.mockResolvedValue({
      data: [COLLECTION_DAY],
      meta: { kind: "collection", row_count: 1 },
      status: 200,
    });

    const run = await fetchReport({
      kind: "collection",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      groupBy: "cashier",
      academicSessionId: SESSION_ID,
    });

    expect(mockGet).toHaveBeenCalledWith("/reports/finance-summary", {
      query: {
        kind: "collection",
        date_from: "2026-10-01",
        date_to: "2026-10-31",
        group_by: "cashier",
        academic_session_id: SESSION_ID,
      },
    });
    expect(run).toEqual({ kind: "collection", rows: [COLLECTION_DAY] });
  });

  it("fetchReport sends the student a statement is for", async () => {
    const { fetchReport } = await import("../finance-reports-service");
    mockGet.mockResolvedValue({ data: [], meta: {}, status: 200 });

    await fetchReport({
      kind: "student-ledger",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-01",
      studentId: STUDENT_ID,
    });

    expect(mockGet).toHaveBeenCalledWith("/reports/finance-summary", {
      query: {
        kind: "student-ledger",
        date_from: "2026-10-01",
        date_to: "2026-10-01",
        student: STUDENT_ID,
      },
    });
  });

  it("fetchStudentStatement reads the lines and the server's closing balance", async () => {
    const { fetchStudentStatement } = await import("../finance-reports-service");
    mockGet.mockResolvedValue({
      data: [STATEMENT_INVOICE, STATEMENT_PAYMENT],
      // Deliberately not the last line's balance: the client shows what it was sent.
      meta: { row_count: 2, closing_balance: "612.50" },
      status: 200,
    });

    const statement = await fetchStudentStatement(STUDENT_ID);

    expect(mockGet).toHaveBeenCalledWith(`/students/${STUDENT_ID}/ledger`);
    expect(statement).toEqual({
      entries: [STATEMENT_INVOICE, STATEMENT_PAYMENT],
      closingBalance: "612.50",
    });
  });

  it("fetchStudentStatement refuses a response with no closing balance", async () => {
    const { fetchStudentStatement } = await import("../finance-reports-service");
    mockGet.mockResolvedValue({ data: [], meta: { row_count: 0 }, status: 200 });

    await expect(fetchStudentStatement(STUDENT_ID)).rejects.toThrow("closing_balance");
  });

  it("exportReport POSTs the same parameters with a format and answers with the job", async () => {
    const { exportReport } = await import("../finance-reports-service");
    mockPost.mockResolvedValue({
      data: { job_id: JOB_ID, status: "queued" },
      meta: { message: "Report export queued." },
      status: 202,
    });

    const accepted = await exportReport(
      {
        kind: "outstanding-aging",
        dateFrom: "2026-10-31",
        dateTo: "2026-10-31",
        classId: SESSION_ID,
      },
      "xlsx",
    );

    expect(mockPost).toHaveBeenCalledWith("/reports/finance-summary", {
      kind: "outstanding-aging",
      date_from: "2026-10-31",
      date_to: "2026-10-31",
      class_id: SESSION_ID,
      format: "xlsx",
    });
    expect(accepted).toEqual({ jobId: JOB_ID });
  });

  it("exportReport sends an Idempotency-Key when given one", async () => {
    const { exportReport } = await import("../finance-reports-service");
    mockPost.mockResolvedValue({
      data: { job_id: JOB_ID, status: "queued" },
      meta: {},
      status: 202,
    });

    await exportReport(
      { kind: "trial-balance", dateFrom: "2026-10-01", dateTo: "2026-10-31" },
      "csv",
      "key-1",
    );

    expect(mockPost).toHaveBeenCalledWith("/reports/finance-summary", expect.any(Object), {
      idempotencyKey: "key-1",
    });
  });
});
