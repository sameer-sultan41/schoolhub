import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPatch = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: jest.fn(),
      put: jest.fn(),
      patch: mockPatch,
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("attendance-settings-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  it("reads the effective settings from /attendance-settings", async () => {
    const { fetchSettings } = await import("../attendance-settings-service");
    mockGet.mockResolvedValue({
      data: { attendance_mode: "period", lock_window_days: 3, leave_escalation_threshold_days: 7 },
    });

    await expect(fetchSettings()).resolves.toEqual({
      attendance_mode: "period",
      lock_window_days: 3,
      leave_escalation_threshold_days: 7,
    });
    expect(mockGet).toHaveBeenCalledWith("/attendance-settings");
  });

  it("patches only the keys it is given, under the API's own names", async () => {
    const { updateSettings } = await import("../attendance-settings-service");
    mockPatch.mockResolvedValue({ data: { attendance_mode: "period" } });

    await updateSettings({ attendanceMode: "period", lockWindowDays: 0 });

    expect(mockPatch).toHaveBeenCalledWith("/attendance-settings", {
      attendance_mode: "period",
      lock_window_days: 0,
    });
  });

  it("sends a zero as a value, not as an absent key", async () => {
    const { updateSettings } = await import("../attendance-settings-service");
    mockPatch.mockResolvedValue({ data: {} });

    await updateSettings({ lockWindowDays: 0 });

    expect(mockPatch).toHaveBeenCalledWith("/attendance-settings", { lock_window_days: 0 });
  });
});
