import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import {
  ATTENDANCE_ID,
  CORRECTION_ID,
  correctionPage,
  correctionRecord,
} from "./attendance-corrections-fixtures";

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

describe("attendance-corrections-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("requests a correction with the snake_case body", async () => {
    const { requestCorrection } = await import("../attendance-corrections-service");
    mockPost.mockResolvedValue({ data: { id: "corr-1", status: "pending" } });

    const created = await requestCorrection({
      studentAttendanceId: ATTENDANCE_ID,
      newValues: { status: "excused", remarks: "Medical note received" },
      reason: "Parent sent a medical note after the lock",
    });

    expect(mockPost).toHaveBeenCalledWith("/attendance-corrections", {
      student_attendance_id: ATTENDANCE_ID,
      new_values: { status: "excused", remarks: "Medical note received" },
      reason: "Parent sent a medical note after the lock",
    });
    expect(created).toEqual({ id: "corr-1", status: "pending" });
  });

  it("pages the corrections by cursor with its filters", async () => {
    const { fetchCorrectionPage } = await import("../attendance-corrections-service");
    const page = correctionPage([correctionRecord()], { next: "n2" });
    mockGet.mockResolvedValue({ data: page.items, meta: { pagination: page.pagination } });

    const result = await fetchCorrectionPage({
      cursor: "c1",
      pageSize: 25,
      ordering: "-created_at",
      status: "pending",
      mine: true,
    });

    expect(result.items).toEqual([correctionRecord()]);
    expect(result.pagination).toMatchObject({ next_cursor: "n2" });
    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/attendance-corrections");
    expect(options.query).toMatchObject({
      cursor: "c1",
      page_size: 25,
      ordering: "-created_at",
      status: "pending",
      mine: true,
    });
  });

  it.each(["approve", "reject"] as const)(
    "posts %s on the colon-action with the note",
    async (action) => {
      const { decideCorrection } = await import("../attendance-corrections-service");
      mockPost.mockResolvedValue({ data: correctionRecord({ status: "approved" }) });

      const decided = await decideCorrection(CORRECTION_ID, action, "Checked the gate log");

      expect(mockPost).toHaveBeenCalledWith(`/attendance-corrections/${CORRECTION_ID}:${action}`, {
        review_note: "Checked the gate log",
      });
      expect(decided.status).toBe("approved");
    },
  );
});
