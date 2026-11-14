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
      downloadBlob: jest.fn(),
    })),
  };
});

describe("settlement-imports-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("listSettlementImports GETs the list path with only the filters given", async () => {
    const { listSettlementImports } = await import("../settlement-imports-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    await listSettlementImports({ status: "completed" });

    expect(mockGet).toHaveBeenCalledWith(
      "/voucher-collection-imports",
      expect.objectContaining({ query: { status: "completed", page_size: 25 } }),
    );
  });

  it("fetchSettlementImport GETs the import's detail path", async () => {
    const { fetchSettlementImport } = await import("../settlement-imports-service");
    mockGet.mockResolvedValue({ data: { id: "i1" } });

    await expect(fetchSettlementImport("i1")).resolves.toEqual({ id: "i1" });
    expect(mockGet).toHaveBeenCalledWith("/voucher-collection-imports/i1");
  });

  it("uploadSettlementImport POSTs the file and provider as multipart with the Idempotency-Key and returns the job id", async () => {
    const { uploadSettlementImport } = await import("../settlement-imports-service");
    mockPost.mockResolvedValue({ data: { job_id: "j1", status: "queued" } });
    const file = new File(["x"], "s.csv", { type: "text/csv" });

    await expect(uploadSettlementImport(file, "jazzcash", "key-1")).resolves.toEqual({
      jobId: "j1",
    });

    const [path, body, options] = mockPost.mock.calls[0] as [
      string,
      FormData,
      { idempotencyKey: string },
    ];
    expect(path).toBe("/voucher-collection-imports");
    expect(body.get("file")).toBe(file);
    expect(body.get("provider")).toBe("jazzcash");
    expect(options).toEqual({ idempotencyKey: "key-1" });
  });
});
