import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: mockPut,
      patch: mockPatch,
      delete: mockDelete,
      refresh: jest.fn(),
    })),
  };
});

const PAGE_META = { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } };

const CAMPUS_INPUT = {
  name: "North",
  code: "NORTH",
  phone: null,
  email: null,
  timezone: null,
  is_primary: false,
  is_active: true,
};

describe("school-organization structure calls", () => {
  beforeEach(() => {
    jest.resetModules();
    for (const mock of [mockGet, mockPost, mockPut, mockPatch, mockDelete]) mock.mockReset();
  });

  it("pages /campuses with the search, ordering and status, keeping is_active=false", async () => {
    const { fetchCampusPage } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchCampusPage({
      page: 2,
      pageSize: 25,
      search: "north",
      ordering: "-name",
      isActive: false,
    });

    expect(mockGet).toHaveBeenCalledWith("/campuses", {
      query: { page: 2, page_size: 25, search: "north", ordering: "-name", is_active: false },
    });
  });

  it("pages /departments with the campus and type, omitting blank filters", async () => {
    const { fetchDepartmentPage } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchDepartmentPage({ page: 1, search: "", campusId: "c-1", departmentType: "academic" });

    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/departments");
    expect(options.query).toMatchObject({ page: 1, campus_id: "c-1", department_type: "academic" });
    expect(options.query).not.toHaveProperty("search");
  });

  it("pages /houses", async () => {
    const { fetchHousePage } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchHousePage({ page: 1, pageSize: 10 });

    expect(mockGet).toHaveBeenCalledWith("/houses", { query: { page: 1, page_size: 10 } });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("creates, updates and deletes a campus on its own paths", async () => {
    const service = await import("../school-organization-service");
    mockPost.mockResolvedValue({ data: { id: "c-1" } });
    mockPatch.mockResolvedValue({ data: { id: "c-1" } });
    mockDelete.mockResolvedValue({ data: null });

    await expect(service.createCampus(CAMPUS_INPUT)).resolves.toEqual({ id: "c-1" });
    await service.updateCampus("c-1", CAMPUS_INPUT);
    await service.deleteCampus("c-1");

    expect(mockPost).toHaveBeenCalledWith("/campuses", CAMPUS_INPUT);
    expect(mockPatch).toHaveBeenCalledWith("/campuses/c-1", CAMPUS_INPUT);
    expect(mockDelete).toHaveBeenCalledWith("/campuses/c-1");
  });

  it("creates, updates and deletes a department on its own paths", async () => {
    const service = await import("../school-organization-service");
    const input = {
      name: "Science",
      code: "SCI",
      department_type: "academic" as const,
      campus_id: null,
      description: null,
      is_active: true,
    };
    mockPost.mockResolvedValue({ data: { id: "d-1" } });
    mockPatch.mockResolvedValue({ data: { id: "d-1" } });
    mockDelete.mockResolvedValue({ data: null });

    await service.createDepartment(input);
    await service.updateDepartment("d-1", input);
    await service.deleteDepartment("d-1");

    expect(mockPost).toHaveBeenCalledWith("/departments", input);
    expect(mockPatch).toHaveBeenCalledWith("/departments/d-1", input);
    expect(mockDelete).toHaveBeenCalledWith("/departments/d-1");
  });

  it("creates, updates and deletes a house on its own paths", async () => {
    const service = await import("../school-organization-service");
    const input = { name: "Red", code: null, color: null, motto: null, is_active: true };
    mockPost.mockResolvedValue({ data: { id: "h-1" } });
    mockPatch.mockResolvedValue({ data: { id: "h-1" } });
    mockDelete.mockResolvedValue({ data: null });

    await service.createHouse(input);
    await service.updateHouse("h-1", input);
    await service.deleteHouse("h-1");

    expect(mockPost).toHaveBeenCalledWith("/houses", input);
    expect(mockPatch).toHaveBeenCalledWith("/houses/h-1", input);
    expect(mockDelete).toHaveBeenCalledWith("/houses/h-1");
  });

  it("reads the calendar, filling a list the response leaves out", async () => {
    const { fetchHolidayCalendar } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: { working_days: [0, 1, 2, 3, 4] } });

    await expect(fetchHolidayCalendar()).resolves.toEqual({
      working_days: [0, 1, 2, 3, 4],
      holidays: [],
    });
    expect(mockGet).toHaveBeenCalledWith("/holiday-calendar");
  });

  it("puts only the list it changes", async () => {
    const { updateHolidayCalendar } = await import("../school-organization-service");
    mockPut.mockResolvedValue({ data: { holidays: [] } });

    await expect(updateHolidayCalendar({ working_days: [0, 1] })).resolves.toEqual({
      working_days: [],
      holidays: [],
    });
    expect(mockPut).toHaveBeenCalledWith("/holiday-calendar", { working_days: [0, 1] });
  });
});
