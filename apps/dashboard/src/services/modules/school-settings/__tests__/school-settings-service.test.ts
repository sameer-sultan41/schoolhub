import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import { schoolSettingsRecord } from "./school-settings-fixtures";

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

describe("school-settings-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  it("reads the singleton from /school-settings", async () => {
    const { fetchSchoolSettings } = await import("../school-settings-service");
    mockGet.mockResolvedValue({ data: schoolSettingsRecord() });

    await expect(fetchSchoolSettings()).resolves.toEqual(schoolSettingsRecord());
    expect(mockGet).toHaveBeenCalledWith("/school-settings");
  });

  it("patches the body it is given", async () => {
    const { updateSchoolSettings } = await import("../school-settings-service");
    mockPatch.mockResolvedValue({ data: schoolSettingsRecord({ name: "North" }) });

    const saved = await updateSchoolSettings({ name: "North" });

    expect(mockPatch).toHaveBeenCalledWith("/school-settings", { name: "North" });
    expect(saved.name).toBe("North");
  });
});
