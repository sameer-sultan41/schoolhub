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

describe("fines-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listFines GETs /fines with the filters mapped to the API's names", async () => {
    const { listFines } = await import("../fines-service");
    mockGet.mockResolvedValue(PAGE);

    await listFines({
      studentId: "s1",
      status: "pending",
      feeHeadId: "h1",
      fineType: "library",
      sourceModule: "library",
      cursor: "c1",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/fines",
      expect.objectContaining({
        query: expect.objectContaining({
          student: "s1",
          status: "pending",
          fee_head_id: "h1",
          fine_type: "library",
          source_module: "library",
          cursor: "c1",
        }),
      }),
    );
  });

  it("createFine POSTs /fines with the snake_case body", async () => {
    const { createFine } = await import("../fines-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createFine({
      studentId: "s1",
      feeHeadId: "h1",
      fineType: "damage",
      amount: "250",
      reason: "Broken window",
    });

    expect(mockPost).toHaveBeenCalledWith("/fines", {
      student: "s1",
      fee_head: "h1",
      fine_type: "damage",
      amount: "250",
      reason: "Broken window",
    });
  });

  it("updateFine PATCHes /fines/{id} with only the fields given", async () => {
    const { updateFine } = await import("../fines-service");
    mockPatch.mockResolvedValue({ data: { id: "x1" } });

    await updateFine("x1", { reason: "Corrected" });

    expect(mockPatch).toHaveBeenCalledWith("/fines/x1", { reason: "Corrected" });
  });

  it("waiveFine POSTs the colon-action with the reason", async () => {
    const { waiveFine } = await import("../fines-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await waiveFine("x1", "Hardship");

    expect(mockPost).toHaveBeenCalledWith("/fines/x1:waive", { reason: "Hardship" });
  });

  it("has no delete call: the route does not exist", async () => {
    const service = await import("../fines-service");

    expect(Object.keys(service).some((name) => /delete|remove/i.test(name))).toBe(false);
  });
});
