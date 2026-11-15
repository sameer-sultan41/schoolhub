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

describe("gallery-albums-service", () => {
  it("lists albums filtered by their event", async () => {
    const { fetchGalleryAlbumPage } = await import("../gallery-albums-service");

    await fetchGalleryAlbumPage({ schoolEventId: "e1" });

    expect(mockGet).toHaveBeenCalledWith(
      "/gallery-albums",
      expect.objectContaining({ query: expect.objectContaining({ school_event_id: "e1" }) }),
    );
  });

  it("writes an album and runs publish and unpublish", async () => {
    const service = await import("../gallery-albums-service");

    await service.createGalleryAlbum({ title: "Fair", slug: "fair" });
    await service.updateGalleryAlbum("a1", { description: "Photos" });
    await service.fetchGalleryAlbum("a1");
    await service.publishGalleryAlbum("a1");
    await service.unpublishGalleryAlbum("a1");
    await service.deleteGalleryAlbum("a1");

    expect(mockPost).toHaveBeenCalledWith("/gallery-albums", { title: "Fair", slug: "fair" });
    expect(mockPatch).toHaveBeenCalledWith("/gallery-albums/a1", { description: "Photos" });
    expect(mockGet).toHaveBeenCalledWith("/gallery-albums/a1");
    expect(mockPost).toHaveBeenCalledWith("/gallery-albums/a1:publish");
    expect(mockPost).toHaveBeenCalledWith("/gallery-albums/a1:unpublish");
    expect(mockDelete).toHaveBeenCalledWith("/gallery-albums/a1");
  });

  it("reads, writes and reorders an album's items", async () => {
    const service = await import("../gallery-albums-service");
    mockGet.mockResolvedValue({ data: [{ id: "i1" }], meta: PAGE_META });

    const items = await service.fetchGalleryItems("a1");
    await service.createGalleryItem("a1", { file_id: "f1", alt_text: "Stage" });
    await service.updateGalleryItem("a1", "i1", { caption: "Opening" });
    await service.deleteGalleryItem("a1", "i1");
    await service.reorderGalleryItems("a1", ["i2", "i1"]);

    expect(items).toEqual([{ id: "i1" }]);
    expect(mockGet).toHaveBeenCalledWith(
      "/gallery-albums/a1/gallery-items",
      expect.objectContaining({ query: { ordering: "position", page_size: 100 } }),
    );
    expect(mockPost).toHaveBeenCalledWith("/gallery-albums/a1/gallery-items", {
      file_id: "f1",
      alt_text: "Stage",
    });
    expect(mockPatch).toHaveBeenCalledWith("/gallery-albums/a1/gallery-items/i1", {
      caption: "Opening",
    });
    expect(mockDelete).toHaveBeenCalledWith("/gallery-albums/a1/gallery-items/i1");
    expect(mockPatch).toHaveBeenCalledWith("/gallery-albums/a1/gallery-items:reorder", {
      ids: ["i2", "i1"],
    });
  });
});
