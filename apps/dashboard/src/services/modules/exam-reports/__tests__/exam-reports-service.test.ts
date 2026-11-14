import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import { EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";

import { ACCEPTED, JOB_ID, resultRegisterRow } from "./exam-reports-fixtures";

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

describe("exam-reports-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("runs a report on one exam inline", async () => {
    const { runReport } = await import("../exam-reports-service");
    const row = resultRegisterRow();
    mockGet.mockResolvedValue({ data: [row], status: 200 });

    const run = await runReport({ kind: "result-register", examId: EXAM_ID });

    expect(mockGet).toHaveBeenCalledWith("/reports/exam-summary", {
      query: { kind: "result-register", exam_id: EXAM_ID },
    });
    expect(run).toEqual({ kind: "result-register", rows: [row] });
  });

  it("sends no exam for question-bank usage", async () => {
    const { runReport } = await import("../exam-reports-service");
    mockGet.mockResolvedValue({ data: [], status: 200 });

    await runReport({ kind: "question-bank-usage" });

    expect(mockGet).toHaveBeenCalledWith("/reports/exam-summary", {
      query: { kind: "question-bank-usage" },
    });
  });

  it("hands back the job a report too large to show answers with", async () => {
    const { runReport } = await import("../exam-reports-service");
    mockGet.mockResolvedValue({ data: ACCEPTED, status: 202 });

    await expect(runReport({ kind: "result-register", examId: EXAM_ID })).resolves.toEqual({
      jobId: JOB_ID,
    });
  });

  it("exports the report in the format asked for", async () => {
    const { exportReport } = await import("../exam-reports-service");
    mockPost.mockResolvedValue({ data: ACCEPTED, status: 202 });

    const accepted = await exportReport({ kind: "pass-fail-analysis", examId: EXAM_ID }, "pdf");

    expect(mockPost).toHaveBeenCalledWith("/reports/exam-summary", {
      kind: "pass-fail-analysis",
      exam_id: EXAM_ID,
      format: "pdf",
    });
    expect(accepted).toEqual({ jobId: JOB_ID });
  });
});
