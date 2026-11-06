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

const PAGE = {
  data: [{ id: "x1" }],
  meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
};

const INPUT = {
  feeStructureId: "f1",
  feeHeadId: "h1",
  amount: "1500.00",
  frequency: "monthly" as const,
  termId: null,
  dueDay: 10,
  dueDate: null,
};

describe("fee-schedules-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listFeeSchedules GETs /fee-schedules as a cursor page with the filters mapped to the API's names", async () => {
    const { listFeeSchedules } = await import("../fee-schedules-service");
    mockGet.mockResolvedValue(PAGE);

    const page = await listFeeSchedules({ feeStructureId: "f1", cursor: "c1", pageSize: 20 });

    expect(mockGet).toHaveBeenCalledWith(
      "/fee-schedules",
      expect.objectContaining({
        query: expect.objectContaining({ fee_structure_id: "f1", cursor: "c1", page_size: 20 }),
      }),
    );
    expect(page.items).toEqual([{ id: "x1" }]);
  });

  it("listFeeSchedules sends no filter it was not given", async () => {
    const { listFeeSchedules } = await import("../fee-schedules-service");
    mockGet.mockResolvedValue(PAGE);

    await listFeeSchedules();

    const query = (mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }])[1].query;
    expect(Object.keys(query)).toEqual(["page_size"]);
  });

  it("fetchFeeSchedule GETs /fee-schedules/{id}", async () => {
    const { fetchFeeSchedule } = await import("../fee-schedules-service");
    mockGet.mockResolvedValue({ data: { id: "x1" } });

    await expect(fetchFeeSchedule("x1")).resolves.toEqual({ id: "x1" });

    expect(mockGet).toHaveBeenCalledWith("/fee-schedules/x1");
  });

  it("createFeeSchedule POSTs /fee-schedules with the snake_case body", async () => {
    const { createFeeSchedule } = await import("../fee-schedules-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createFeeSchedule(INPUT);

    expect(mockPost).toHaveBeenCalledWith("/fee-schedules", {
      fee_structure: "f1",
      fee_head: "h1",
      amount: "1500.00",
      frequency: "monthly",
      term: null,
      due_day: 10,
      due_date: null,
    });
  });

  it("updateFeeSchedule PATCHes /fee-schedules/{id} with only the fields given", async () => {
    const { updateFeeSchedule } = await import("../fee-schedules-service");
    mockPatch.mockResolvedValue({ data: { id: "x1" } });

    await updateFeeSchedule("x1", { amount: "2000.00" });

    expect(mockPatch).toHaveBeenCalledWith("/fee-schedules/x1", { amount: "2000.00" });
  });

  it("deleteFeeSchedule DELETEs /fee-schedules/{id}", async () => {
    const { deleteFeeSchedule } = await import("../fee-schedules-service");
    mockDelete.mockResolvedValue({});

    await deleteFeeSchedule("x1");

    expect(mockDelete).toHaveBeenCalledWith("/fee-schedules/x1");
  });
});
