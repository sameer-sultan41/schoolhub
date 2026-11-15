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

describe("news-posts-service", () => {
  it("lists /news-posts with the shared content filters", async () => {
    const { fetchNewsPostPage } = await import("../news-posts-service");

    await fetchNewsPostPage({ search: "sports", ordering: "updated_at", status: "published" });

    expect(mockGet).toHaveBeenCalledWith(
      "/news-posts",
      expect.objectContaining({
        query: expect.objectContaining({
          search: "sports",
          ordering: "updated_at",
          status: "published",
        }),
      }),
    );
  });

  it("writes a post and runs its lifecycle actions", async () => {
    const service = await import("../news-posts-service");
    const input = { title: "Sports day", slug: "sports-day", body: { blocks: [] } };

    await service.createNewsPost(input);
    await service.updateNewsPost("n1", { excerpt: "Short" });
    await service.fetchNewsPost("n1");
    await service.publishNewsPost("n1");
    await service.unpublishNewsPost("n1");
    await service.archiveNewsPost("n1");
    await service.deleteNewsPost("n1");

    expect(mockPost).toHaveBeenCalledWith("/news-posts", input);
    expect(mockPatch).toHaveBeenCalledWith("/news-posts/n1", { excerpt: "Short" });
    expect(mockGet).toHaveBeenCalledWith("/news-posts/n1");
    expect(mockPost.mock.calls.slice(1).map((call: unknown[]) => call[0])).toEqual([
      "/news-posts/n1:publish",
      "/news-posts/n1:unpublish",
      "/news-posts/n1:archive",
    ]);
    expect(mockDelete).toHaveBeenCalledWith("/news-posts/n1");
  });
});
