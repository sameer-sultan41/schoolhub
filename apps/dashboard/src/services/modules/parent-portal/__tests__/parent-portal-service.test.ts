import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDownloadBlob = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: jest.fn(),
      refresh: jest.fn(),
      downloadBlob: mockDownloadBlob,
    })),
  };
});

describe("parent-portal-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("fetchPortalDashboard GETs the dashboard path and unwraps data", async () => {
    const { fetchPortalDashboard } = await import("../parent-portal-service");
    mockGet.mockResolvedValue({ data: { children: [], unread_notifications: 0 } });

    const result = await fetchPortalDashboard();

    expect(mockGet).toHaveBeenCalledWith("/parent-portal/dashboard");
    expect(result).toEqual({ children: [], unread_notifications: 0 });
  });
});
