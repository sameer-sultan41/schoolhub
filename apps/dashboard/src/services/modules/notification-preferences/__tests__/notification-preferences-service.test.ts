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

describe("notification-preferences-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("fetchNotificationPreferences GETs the preferences path", async () => {
    const { fetchNotificationPreferences } = await import("../notification-preferences-service");
    mockGet.mockResolvedValue({ data: [] });

    await fetchNotificationPreferences();

    expect(mockGet).toHaveBeenCalledWith("/notification-preferences");
  });

  it("updateNotificationPreferences PATCHes the changed cells", async () => {
    const { updateNotificationPreferences } = await import("../notification-preferences-service");
    mockPatch.mockResolvedValue({ data: [] });
    const rows = [{ event_category: "fees", channel: "email", is_enabled: false }] as const;

    await updateNotificationPreferences([...rows]);

    expect(mockPatch).toHaveBeenCalledWith("/notification-preferences", rows);
  });
});
