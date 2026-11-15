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

describe("navigation-menus-service", () => {
  it("reads every menu and replaces one location's items", async () => {
    const { fetchNavigationMenus, updateNavigationMenu } =
      await import("../navigation-menus-service");
    const items = [{ label: "News", target_type: "news_index" as const }];

    await fetchNavigationMenus();
    await updateNavigationMenu("header", items);

    expect(mockGet).toHaveBeenCalledWith("/navigation-menus");
    expect(mockPatch).toHaveBeenCalledWith("/navigation-menus/header", { items });
  });
});
