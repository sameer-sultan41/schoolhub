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

const INPUT = { name: "Grade 5", academicSessionId: "s1", classId: null, campusId: "m1" };

describe("fee-structures-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listFeeStructures GETs /fee-structures as a cursor page with the filters mapped to the API's names", async () => {
    const { listFeeStructures } = await import("../fee-structures-service");
    mockGet.mockResolvedValue(PAGE);

    const page = await listFeeStructures({
      academicSessionId: "s1",
      classId: "k1",
      campusId: "m1",
      status: "draft",
      cursor: "c1",
      pageSize: 20,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/fee-structures",
      expect.objectContaining({
        query: expect.objectContaining({
          academic_session_id: "s1",
          class_id: "k1",
          campus_id: "m1",
          status: "draft",
          cursor: "c1",
          page_size: 20,
        }),
      }),
    );
    expect(page.items).toEqual([{ id: "x1" }]);
  });

  it("listFeeStructures sends no filter it was not given", async () => {
    const { listFeeStructures } = await import("../fee-structures-service");
    mockGet.mockResolvedValue(PAGE);

    await listFeeStructures();

    const query = (mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }])[1].query;
    expect(Object.keys(query)).toEqual(["page_size"]);
  });

  it("fetchFeeStructure GETs /fee-structures/{id}", async () => {
    const { fetchFeeStructure } = await import("../fee-structures-service");
    mockGet.mockResolvedValue({ data: { id: "x1" } });

    await expect(fetchFeeStructure("x1")).resolves.toEqual({ id: "x1" });

    expect(mockGet).toHaveBeenCalledWith("/fee-structures/x1");
  });

  it("createFeeStructure POSTs /fee-structures with the snake_case body", async () => {
    const { createFeeStructure } = await import("../fee-structures-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createFeeStructure(INPUT);

    expect(mockPost).toHaveBeenCalledWith("/fee-structures", {
      name: "Grade 5",
      academic_session: "s1",
      school_class: null,
      campus: "m1",
    });
  });

  it("updateFeeStructure PATCHes /fee-structures/{id} with only the fields given", async () => {
    const { updateFeeStructure } = await import("../fee-structures-service");
    mockPatch.mockResolvedValue({ data: { id: "x1" } });

    await updateFeeStructure("x1", { name: "Renamed" });

    expect(mockPatch).toHaveBeenCalledWith("/fee-structures/x1", { name: "Renamed" });
  });

  it("deleteFeeStructure DELETEs /fee-structures/{id}", async () => {
    const { deleteFeeStructure } = await import("../fee-structures-service");
    mockDelete.mockResolvedValue({});

    await deleteFeeStructure("x1");

    expect(mockDelete).toHaveBeenCalledWith("/fee-structures/x1");
  });

  it("activateFeeStructure POSTs the :activate colon-action and never PATCHes the status", async () => {
    const { activateFeeStructure } = await import("../fee-structures-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await activateFeeStructure("x1");

    expect(mockPost).toHaveBeenCalledWith("/fee-structures/x1:activate");
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("archiveFeeStructure POSTs the :archive colon-action and never PATCHes the status", async () => {
    const { archiveFeeStructure } = await import("../fee-structures-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await archiveFeeStructure("x1");

    expect(mockPost).toHaveBeenCalledWith("/fee-structures/x1:archive");
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
