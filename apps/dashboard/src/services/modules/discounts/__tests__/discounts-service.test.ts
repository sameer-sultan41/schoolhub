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

describe("discounts-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listDiscounts GETs /discounts as a cursor page with the filters mapped to the API's names", async () => {
    const { listDiscounts } = await import("../discounts-service");
    mockGet.mockResolvedValue(PAGE);

    const page = await listDiscounts({
      studentId: "s1",
      status: "active",
      academicSessionId: "a1",
      feeHeadId: "h1",
      discountType: "percent",
      search: "sib",
      cursor: "c1",
      pageSize: 20,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/discounts",
      expect.objectContaining({
        query: expect.objectContaining({
          student: "s1",
          status: "active",
          academic_session_id: "a1",
          fee_head_id: "h1",
          discount_type: "percent",
          search: "sib",
          cursor: "c1",
          page_size: 20,
        }),
      }),
    );
    expect(page.items).toEqual([{ id: "x1" }]);
  });

  it("createDiscount POSTs /discounts with the snake_case body, null for no head", async () => {
    const { createDiscount } = await import("../discounts-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createDiscount({
      studentId: "s1",
      academicSessionId: "a1",
      name: "Sibling",
      discountType: "percent",
      value: "10",
      feeHeadId: null,
    });

    expect(mockPost).toHaveBeenCalledWith("/discounts", {
      student: "s1",
      academic_session: "a1",
      name: "Sibling",
      discount_type: "percent",
      value: "10",
      fee_head: null,
    });
  });

  it("updateDiscount PATCHes /discounts/{id} with only the fields given", async () => {
    const { updateDiscount } = await import("../discounts-service");
    mockPatch.mockResolvedValue({ data: { id: "x1" } });

    await updateDiscount("x1", { name: "Renamed" });

    expect(mockPatch).toHaveBeenCalledWith("/discounts/x1", { name: "Renamed" });
  });

  it("revokeDiscount POSTs the colon-action with the reason", async () => {
    const { revokeDiscount } = await import("../discounts-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await revokeDiscount("x1", "Sibling left");

    expect(mockPost).toHaveBeenCalledWith("/discounts/x1:revoke", { reason: "Sibling left" });
  });

  it("has no delete call: the route does not exist", async () => {
    const service = await import("../discounts-service");

    expect(Object.keys(service).some((name) => /delete|remove/i.test(name))).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
