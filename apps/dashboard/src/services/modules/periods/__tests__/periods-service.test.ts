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

const PAGE_META = { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } };

const INPUT = {
  campusId: null,
  name: "Recess",
  sequence: 3,
  startTime: "10:00",
  endTime: "10:20",
  isBreak: true,
  weekdays: [0, 1],
};

const BODY = {
  campus_id: null,
  name: "Recess",
  sequence: 3,
  start_time: "10:00",
  end_time: "10:20",
  is_break: true,
  weekdays: [0, 1],
};

describe("periods-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("lists /periods, asking for a campus's periods with for_campus", async () => {
    const { fetchPeriodPage } = await import("../periods-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchPeriodPage({
      page: 2,
      pageSize: 25,
      search: "recess",
      ordering: "-sequence",
      forCampusId: "campus-1",
      isBreak: true,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/periods",
      expect.objectContaining({
        query: {
          page: 2,
          page_size: 25,
          search: "recess",
          ordering: "-sequence",
          for_campus: "campus-1",
          is_break: true,
        },
      }),
    );
  });

  it("creates, updates and deletes through the snake_case body", async () => {
    const { createPeriod, deletePeriod, updatePeriod } = await import("../periods-service");
    mockPost.mockResolvedValue({ data: { id: "p1" } });
    mockPatch.mockResolvedValue({ data: { id: "p1" } });

    await createPeriod(INPUT);
    await updatePeriod("p1", INPUT);
    await deletePeriod("p1");

    expect(mockPost).toHaveBeenCalledWith("/periods", BODY);
    expect(mockPatch).toHaveBeenCalledWith("/periods/p1", BODY);
    expect(mockDelete).toHaveBeenCalledWith("/periods/p1");
  });
});
