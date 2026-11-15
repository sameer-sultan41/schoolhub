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

describe("contact-submissions-service", () => {
  it("lists the inbox by status and date window", async () => {
    const { fetchContactSubmissionPage } = await import("../contact-submissions-service");

    await fetchContactSubmissionPage({
      page: 2,
      status: "new",
      createdFrom: "2026-11-01",
      createdTo: "2026-11-30",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/contact-submissions",
      expect.objectContaining({
        query: expect.objectContaining({
          page: 2,
          status: "new",
          created_at__gte: "2026-11-01",
          created_at__lte: "2026-11-30",
        }),
      }),
    );
  });

  it("reads one submission and triages it with a status PATCH", async () => {
    const { fetchContactSubmission, setContactSubmissionStatus } =
      await import("../contact-submissions-service");
    mockGet.mockResolvedValue({ data: { id: "c1" } });

    await fetchContactSubmission("c1");
    await setContactSubmissionStatus("c1", "spam");

    expect(mockGet).toHaveBeenCalledWith("/contact-submissions/c1");
    expect(mockPatch).toHaveBeenCalledWith("/contact-submissions/c1", { status: "spam" });
  });
});
