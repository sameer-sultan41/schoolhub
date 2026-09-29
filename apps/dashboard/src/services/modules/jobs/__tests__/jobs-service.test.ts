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
    })),
  };
});

describe("jobs-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  describe("fetchJob", () => {
    it("reads GET /jobs/{id} and returns the job record", async () => {
      const { fetchJob } = await import("../jobs-service");
      mockGet.mockResolvedValue({
        data: {
          id: "job-1",
          job_type: "export.staff",
          status: "running",
          progress: 40,
          result: null,
          error: null,
        },
      });

      const job = await fetchJob("job-1");

      expect(mockGet).toHaveBeenCalledWith("/jobs/job-1");
      expect(job).toEqual({
        id: "job-1",
        job_type: "export.staff",
        status: "running",
        progress: 40,
        result: null,
        error: null,
      });
    });
  });

  describe("fetchFileDownloadUrl", () => {
    it("posts the files:download colon-action and returns the signed URL", async () => {
      const { fetchFileDownloadUrl } = await import("../jobs-service");
      mockPost.mockResolvedValue({ data: { download_url: "https://storage.test/x.csv" } });

      const url = await fetchFileDownloadUrl("file-1");

      expect(mockPost).toHaveBeenCalledWith("/files/file-1:download");
      expect(url).toBe("https://storage.test/x.csv");
    });
  });
});
