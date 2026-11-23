import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import { onboardingRecord } from "@/test-fixtures/onboarding";

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

describe("onboarding-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  it("reads the checklist from /onboarding", async () => {
    const { fetchOnboarding } = await import("../onboarding-service");
    mockGet.mockResolvedValue({ data: onboardingRecord() });

    await expect(fetchOnboarding()).resolves.toEqual(onboardingRecord());
    expect(mockGet).toHaveBeenCalledWith("/onboarding");
  });

  it("patches one action and answers the updated checklist", async () => {
    const { updateOnboarding } = await import("../onboarding-service");
    const updated = onboardingRecord({ skipped: ["students"] });
    mockPatch.mockResolvedValue({ data: updated });

    await expect(updateOnboarding({ skip: "students" })).resolves.toEqual(updated);
    expect(mockPatch).toHaveBeenCalledWith("/onboarding", { skip: "students" });
  });
});
