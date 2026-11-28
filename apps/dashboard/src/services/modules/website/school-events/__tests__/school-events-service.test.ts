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

describe("school-events-service", () => {
  it("lists /school-events with the starts_at window", async () => {
    const { fetchSchoolEventPage } = await import("../school-events-service");

    await fetchSchoolEventPage({ startsAfter: "2026-01-01T00:00:00Z", status: "draft" });

    expect(mockGet).toHaveBeenCalledWith(
      "/school-events",
      expect.objectContaining({
        query: expect.objectContaining({ starts_after: "2026-01-01T00:00:00Z", status: "draft" }),
      }),
    );
    expect(mockGet.mock.calls[0]?.[1]?.query).not.toHaveProperty("starts_before");
  });

  it("writes an event and runs its lifecycle actions", async () => {
    const service = await import("../school-events-service");
    const input = { title: "Fair", slug: "fair", starts_at: "2026-12-01T09:00:00Z" };

    await service.createSchoolEvent(input);
    await service.updateSchoolEvent("e1", { location: "Hall" });
    await service.fetchSchoolEvent("e1");
    await service.publishSchoolEvent("e1");
    await service.unpublishSchoolEvent("e1");
    await service.archiveSchoolEvent("e1");

    expect(mockPost).toHaveBeenCalledWith("/school-events", input);
    expect(mockPatch).toHaveBeenCalledWith("/school-events/e1", { location: "Hall" });
    expect(mockGet).toHaveBeenCalledWith("/school-events/e1");
    expect(mockPost.mock.calls.slice(1).map((call: unknown[]) => call[0])).toEqual([
      "/school-events/e1:publish",
      "/school-events/e1:unpublish",
      "/school-events/e1:archive",
    ]);
    // §4 has no delete key and the API no DELETE route: an event is archived instead.
    expect(service).not.toHaveProperty("deleteSchoolEvent");
  });
});
