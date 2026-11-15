import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: mockDelete,
      refresh: jest.fn(),
    })),
  };
});

const PAGE_META = { pagination: { page: 1, page_size: 1, total_count: 3, total_pages: 3 } };

beforeEach(() => {
  jest.resetModules();
  for (const mock of [mockGet, mockPost, mockPatch, mockDelete]) mock.mockReset();
  mockGet.mockResolvedValue({ data: [], meta: PAGE_META });
  mockPost.mockResolvedValue({ data: { id: "x1" } });
  mockPatch.mockResolvedValue({ data: { id: "x1" } });
});

describe("seo-settings-service", () => {
  it("addresses the site row without a target id", async () => {
    const { fetchSeoSetting } = await import("../seo-settings-service");

    await fetchSeoSetting({ targetType: "site" });

    expect(mockGet).toHaveBeenCalledWith("/seo-settings", { query: { target_type: "site" } });
  });

  it("patches one record's row by type and id", async () => {
    const { updateSeoSetting } = await import("../seo-settings-service");

    await updateSeoSetting({ targetType: "page", targetId: "p1" }, { meta_title: "About" });

    expect(mockPatch).toHaveBeenCalledWith(
      "/seo-settings",
      { meta_title: "About" },
      { query: { target_type: "page", target_id: "p1" } },
    );
  });
});
