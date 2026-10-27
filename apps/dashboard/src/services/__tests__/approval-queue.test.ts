import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("approval-queue service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads one cursor page of the path with the mapped query", async () => {
    const { fetchApprovalPage } = await import("../approval-queue");
    mockGet.mockResolvedValue({
      data: [{ id: "a" }],
      meta: { pagination: { next_cursor: "n2" } },
    });

    const page = await fetchApprovalPage("/queue", { cursor: "c1", page_size: 25, mine: true });

    expect(page.items).toEqual([{ id: "a" }]);
    expect(page.pagination).toMatchObject({ next_cursor: "n2" });
    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/queue");
    expect(options.query).toMatchObject({ cursor: "c1", page_size: 25, mine: true });
  });

  it("posts the note under the given field and returns the record with meta", async () => {
    const { postApprovalDecision } = await import("../approval-queue");
    mockPost.mockResolvedValue({ data: { id: "a" }, meta: { auto_marked_days: 2 } });

    const result = await postApprovalDecision("/queue/a:approve", "note", " Seen ");

    expect(mockPost).toHaveBeenCalledWith("/queue/a:approve", { note: "Seen" });
    expect(result).toEqual({ data: { id: "a" }, meta: { auto_marked_days: 2 } });
  });

  it("posts an empty body without a note", async () => {
    const { postApprovalDecision } = await import("../approval-queue");
    mockPost.mockResolvedValue({ data: { id: "a" }, meta: undefined });

    await postApprovalDecision("/queue/a:reject", "review_note");

    expect(mockPost).toHaveBeenCalledWith("/queue/a:reject", {});
  });
});
