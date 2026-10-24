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

describe("teacher-substitutions-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("pages the queue with its filters, leaving out the blank ones", async () => {
    const { fetchSubstitutionPage } = await import("../teacher-substitutions-service");
    mockGet.mockResolvedValue({
      data: [{ id: "sub-1" }],
      meta: { pagination: { page: 2, page_size: 25, total_count: 26, total_pages: 2 } },
    });

    const page = await fetchSubstitutionPage({
      page: 2,
      pageSize: 25,
      search: "",
      status: "proposed",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });

    expect(page.items).toEqual([{ id: "sub-1" }]);
    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/teacher-substitutions");
    expect(options.query).toMatchObject({
      page: 2,
      page_size: 25,
      status: "proposed",
      date__gte: "2026-10-01",
      date__lte: "2026-10-31",
    });
    expect(options.query).not.toHaveProperty("search");
  });

  it("asks for the free teachers for one slot on one date", async () => {
    const { fetchCandidates } = await import("../teacher-substitutions-service");
    mockGet.mockResolvedValue({ data: [{ staff_id: "t1", staff_name: "Bilal Khan" }] });

    const found = await fetchCandidates("slot-1", "2026-10-19");

    expect(mockGet).toHaveBeenCalledWith("/teacher-substitutions/candidates", {
      query: { timetable_slot_id: "slot-1", date: "2026-10-19" },
    });
    expect(found).toEqual([{ staff_id: "t1", staff_name: "Bilal Khan" }]);
  });

  it("proposes with the snake_case body and decides on the colon-action", async () => {
    const { decideSubstitution, proposeSubstitution } =
      await import("../teacher-substitutions-service");
    mockPost.mockResolvedValue({ data: { id: "sub-1" } });

    await proposeSubstitution({
      timetableSlotId: "slot-1",
      date: "2026-10-19",
      absentStaffId: "a",
      substituteStaffId: "b",
      roomId: null,
      reason: "Sick",
    });
    await decideSubstitution("sub-1", "cancel");

    expect(mockPost).toHaveBeenNthCalledWith(1, "/teacher-substitutions", {
      timetable_slot_id: "slot-1",
      date: "2026-10-19",
      absent_staff_id: "a",
      substitute_staff_id: "b",
      room_id: null,
      reason: "Sick",
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/teacher-substitutions/sub-1:cancel", {});
  });
});
