import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

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
    })),
  };
});

const CURSOR_META = { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } };
const SESSION_INPUT = { name: "2027-28", start_date: "2027-04-01", end_date: "2028-03-31" };
const TERM_INPUT = {
  name: "Term 1",
  sequence: 1,
  start_date: "2027-04-01",
  end_date: "2027-09-30",
};

describe("school-organization session and term calls", () => {
  beforeEach(() => {
    jest.resetModules();
    for (const mock of [mockGet, mockPost, mockPatch]) mock.mockReset();
  });

  it("pages /academic-sessions by cursor with the search, ordering and status", async () => {
    const { fetchSessionPage } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: [], meta: CURSOR_META });

    await fetchSessionPage({
      cursor: "c2",
      pageSize: 25,
      search: "2027",
      ordering: "-start_date",
      status: "planned",
    });

    expect(mockGet).toHaveBeenCalledWith("/academic-sessions", {
      query: {
        cursor: "c2",
        page_size: 25,
        search: "2027",
        ordering: "-start_date",
        status: "planned",
      },
    });
  });

  it("omits the filters a first, unfiltered page does not set", async () => {
    const { fetchSessionPage } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: [], meta: CURSOR_META });

    await fetchSessionPage({ pageSize: 25, search: "" });

    expect(mockGet).toHaveBeenCalledWith("/academic-sessions", { query: { page_size: 25 } });
  });

  it("creates and edits a session on its own paths", async () => {
    const service = await import("../school-organization-service");
    mockPost.mockResolvedValue({ data: { id: "s-1" } });
    mockPatch.mockResolvedValue({ data: { id: "s-1" } });

    await expect(service.createSession(SESSION_INPUT)).resolves.toEqual({ id: "s-1" });
    await service.updateSession("s-1", SESSION_INPUT);

    expect(mockPost).toHaveBeenCalledWith("/academic-sessions", SESSION_INPUT);
    expect(mockPatch).toHaveBeenCalledWith("/academic-sessions/s-1", SESSION_INPUT);
  });

  it("posts the lifecycle colon-actions, with a body only for the clone", async () => {
    const service = await import("../school-organization-service");
    mockPost.mockResolvedValue({ data: { id: "s-2" } });

    await service.activateSession("s-1");
    await service.closeSession("s-1");
    await expect(service.cloneSession("s-1", SESSION_INPUT)).resolves.toEqual({ id: "s-2" });

    expect(mockPost.mock.calls).toEqual([
      ["/academic-sessions/s-1:activate"],
      ["/academic-sessions/s-1:close"],
      ["/academic-sessions/s-1:clone", SESSION_INPUT],
    ]);
  });

  it("creates a term in its session and edits one on its own path", async () => {
    const service = await import("../school-organization-service");
    mockPost.mockResolvedValue({ data: { id: "t-1" } });
    mockPatch.mockResolvedValue({ data: { id: "t-1" } });

    await service.createTerm({ ...TERM_INPUT, academic_session_id: "s-1" });
    await service.updateTerm("t-1", TERM_INPUT);

    expect(mockPost).toHaveBeenCalledWith("/terms", { ...TERM_INPUT, academic_session_id: "s-1" });
    expect(mockPatch).toHaveBeenCalledWith("/terms/t-1", TERM_INPUT);
  });
});
