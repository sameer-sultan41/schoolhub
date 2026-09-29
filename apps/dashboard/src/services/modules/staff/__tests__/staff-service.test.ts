import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: jest.fn(),
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("staff-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockPost.mockReset();
  });

  describe("triggerStaffExport", () => {
    it("posts /staff-exports and returns the queued job's id", async () => {
      const { triggerStaffExport } = await import("../staff-service");
      mockPost.mockResolvedValue({ data: { job_id: "job-export-1", status: "queued" } });

      const result = await triggerStaffExport();

      expect(mockPost).toHaveBeenCalledWith("/staff-exports");
      expect(result).toEqual({ jobId: "job-export-1" });
    });
  });

  describe("triggerStaffImport", () => {
    it("posts /staff-imports as multipart form data and returns the queued job's id", async () => {
      const { triggerStaffImport } = await import("../staff-service");
      mockPost.mockResolvedValue({ data: { job_id: "job-import-1", status: "queued" } });
      const file = new File(["a,b\n1,2"], "staff.csv", { type: "text/csv" });

      const result = await triggerStaffImport(file);

      expect(mockPost).toHaveBeenCalledWith("/staff-imports", expect.any(FormData));
      const body = mockPost.mock.calls[0]?.[1] as FormData;
      expect(body.get("file")).toBe(file);
      expect(result).toEqual({ jobId: "job-import-1" });
    });
  });
});
