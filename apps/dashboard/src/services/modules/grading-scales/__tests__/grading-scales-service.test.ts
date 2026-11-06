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

const SCALE_INPUT = {
  name: "GPA",
  scaleType: "gpa" as const,
  gpaMax: "4.00",
  description: null,
};

const BAND_INPUT = {
  label: "A",
  minPercent: "80",
  maxPercent: "100",
  gradePoint: "4.00",
  isPassing: true,
  remark: null,
  sortOrder: 0,
};

describe("grading-scales-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("lists /grading-scales a page at a time, with its type filter and ordering", async () => {
    const { fetchScalesPage } = await import("../grading-scales-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchScalesPage({
      page: 2,
      pageSize: 10,
      search: "gpa",
      ordering: "-name",
      scaleType: "gpa",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/grading-scales",
      expect.objectContaining({
        query: { page: 2, page_size: 10, search: "gpa", ordering: "-name", scale_type: "gpa" },
      }),
    );
  });

  it("reads, creates, updates and deletes a scale through the snake_case body", async () => {
    const service = await import("../grading-scales-service");
    mockGet.mockResolvedValue({ data: { id: "s1" } });
    mockPost.mockResolvedValue({ data: { id: "s1" } });
    mockPatch.mockResolvedValue({ data: { id: "s1" } });
    mockDelete.mockResolvedValue({});

    await service.fetchScale("s1");
    await service.createScale(SCALE_INPUT);
    await service.updateScale("s1", SCALE_INPUT);
    await service.deleteScale("s1");

    const body = { name: "GPA", scale_type: "gpa", gpa_max: "4.00", description: null };
    expect(mockGet).toHaveBeenCalledWith("/grading-scales/s1");
    expect(mockPost).toHaveBeenCalledWith("/grading-scales", body);
    expect(mockPatch).toHaveBeenCalledWith("/grading-scales/s1", body);
    expect(mockDelete).toHaveBeenCalledWith("/grading-scales/s1");
  });

  it("makes a scale the default through the :set-default action, never a PATCH", async () => {
    const { setDefault } = await import("../grading-scales-service");
    mockPost.mockResolvedValue({ data: { id: "s1", is_default: true } });

    await setDefault("s1");

    expect(mockPost).toHaveBeenCalledWith("/grading-scales/s1:set-default");
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("reads an unpaginated array of bands, and writes them under the scale", async () => {
    const service = await import("../grading-scales-service");
    mockGet.mockResolvedValue({ data: [{ id: "b1" }] });
    mockPost.mockResolvedValue({ data: { id: "b1" } });
    mockPatch.mockResolvedValue({ data: { id: "b1" } });
    mockDelete.mockResolvedValue({});

    await expect(service.fetchBands("s1")).resolves.toEqual([{ id: "b1" }]);
    await service.createBand("s1", BAND_INPUT);
    await service.updateBand("s1", "b1", BAND_INPUT);
    await service.deleteBand("s1", "b1");

    const body = {
      label: "A",
      min_percent: "80",
      max_percent: "100",
      grade_point: "4.00",
      is_passing: true,
      remark: null,
      sort_order: 0,
    };
    expect(mockGet).toHaveBeenCalledWith("/grading-scales/s1/grade-bands");
    expect(mockPost).toHaveBeenCalledWith("/grading-scales/s1/grade-bands", body);
    expect(mockPatch).toHaveBeenCalledWith("/grading-scales/s1/grade-bands/b1", body);
    expect(mockDelete).toHaveBeenCalledWith("/grading-scales/s1/grade-bands/b1");
  });
});
