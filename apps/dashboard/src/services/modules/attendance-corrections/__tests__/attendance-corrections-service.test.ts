import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: jest.fn(),
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

const ATTENDANCE_ID = "33333333-aaaa-4bbb-8ccc-000000000001";

describe("attendance-corrections-service", () => {
  beforeEach(() => {
    jest.resetModules();
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
});
