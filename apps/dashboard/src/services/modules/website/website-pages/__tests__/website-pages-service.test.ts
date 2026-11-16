import type * as ApiClientModule from "@schoolhub/api-client";
import { MAX_PAGE_SIZE, type ApiClientConfig } from "@schoolhub/api-client";

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

describe("website-pages-service", () => {
  it("lists /website-pages with only the filters given, and reads the total", async () => {
    const { fetchWebsitePagePage } = await import("../website-pages-service");

    const page = await fetchWebsitePagePage({
      page: 1,
      pageSize: 1,
      status: "draft",
      pageType: "home",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/website-pages",
      expect.objectContaining({
        query: { page: 1, page_size: 1, status: "draft", page_type: "home" },
      }),
    );
    expect(page.pagination).toEqual(PAGE_META.pagination);
  });

  it("reads every published page by title in one page, for the menu's page picker", async () => {
    const { fetchPublishedWebsitePages } = await import("../website-pages-service");
    mockGet.mockResolvedValue({ data: [{ id: "p1" }], meta: PAGE_META });

    const pages = await fetchPublishedWebsitePages();

    expect(mockGet).toHaveBeenCalledWith(
      "/website-pages",
      expect.objectContaining({
        query: { page_size: MAX_PAGE_SIZE, ordering: "title", status: "published" },
      }),
    );
    expect(pages).toEqual([{ id: "p1" }]);
  });

  it("creates, reads, updates and deletes a page", async () => {
    const { createWebsitePage, deleteWebsitePage, fetchWebsitePage, updateWebsitePage } =
      await import("../website-pages-service");
    mockGet.mockResolvedValue({ data: { id: "p1" } });

    await createWebsitePage({ title: "About", slug: "about" });
    await fetchWebsitePage("p1");
    await updateWebsitePage("p1", { title: "About us" });
    await deleteWebsitePage("p1");

    expect(mockPost).toHaveBeenCalledWith("/website-pages", { title: "About", slug: "about" });
    expect(mockGet).toHaveBeenCalledWith("/website-pages/p1");
    expect(mockPatch).toHaveBeenCalledWith("/website-pages/p1", { title: "About us" });
    expect(mockDelete).toHaveBeenCalledWith("/website-pages/p1");
  });

  it("replaces the sections in one PATCH, in the order given", async () => {
    const { replacePageSections } = await import("../website-pages-service");
    const sections = [
      { section_type: "hero" as const, content: { heading: "Welcome" }, is_visible: true },
      { id: "s2", section_type: "faq" as const, content: { items: [] }, is_visible: false },
    ];

    await replacePageSections("p1", sections);

    expect(mockPatch).toHaveBeenCalledWith("/website-pages/p1/page-sections", { sections });
  });

  it("posts the lifecycle colon-actions and the preview", async () => {
    const service = await import("../website-pages-service");
    mockPost.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: {} });
    mockPost.mockResolvedValueOnce({ data: {} });
    mockPost.mockResolvedValueOnce({ data: { url: "https://x.test/preview", expires_in: 600 } });

    await service.publishWebsitePage("p1");
    await service.unpublishWebsitePage("p1");
    await service.archiveWebsitePage("p1");
    const preview = await service.previewWebsitePage("p1");

    expect(mockPost.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "/website-pages/p1:publish",
      "/website-pages/p1:unpublish",
      "/website-pages/p1:archive",
      "/website-pages/p1:preview",
    ]);
    expect(preview.url).toBe("https://x.test/preview");
  });
});
