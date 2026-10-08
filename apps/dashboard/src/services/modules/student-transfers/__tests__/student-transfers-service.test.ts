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

describe("student-transfers-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("fetchStudentTransfers fetches a single bounded page using MAX_PAGE_SIZE", async () => {
    const { fetchStudentTransfers } = await import("../student-transfers-service");
    mockGet.mockResolvedValue({
      data: [{ id: "t1" }],
      meta: { pagination: { page: 1, page_size: 100, total_count: 1, total_pages: 1 } },
    });

    const result = await fetchStudentTransfers("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/student-transfers",
      expect.objectContaining({
        query: { student_id: "student-1", page_size: expect.any(Number) },
      }),
    );
    expect(result).toEqual([{ id: "t1" }]);
  });

  describe("requestTransfer", () => {
    it("posts the inter_campus body with no idempotencyKey option", async () => {
      const { requestTransfer } = await import("../student-transfers-service");
      mockPost.mockResolvedValue({ data: { id: "t1" } });

      await requestTransfer("student-1", {
        transferType: "inter_campus",
        fromCampusId: "campus-1",
        toCampusId: "campus-2",
        reason: "Family relocation",
        effectiveDate: "2026-11-01",
      });

      expect(mockPost).toHaveBeenCalledWith("/student-transfers", {
        student_id: "student-1",
        transfer_type: "inter_campus",
        from_campus_id: "campus-1",
        to_campus_id: "campus-2",
        reason: "Family relocation",
        effective_date: "2026-11-01",
      });
      expect(mockPost.mock.calls[0]).toHaveLength(2);
    });

    it("posts the outgoing body with external_school_name, never to_campus_id", async () => {
      const { requestTransfer } = await import("../student-transfers-service");
      mockPost.mockResolvedValue({ data: { id: "t1" } });

      await requestTransfer("student-1", {
        transferType: "outgoing",
        fromCampusId: "campus-1",
        externalSchoolName: "Another School",
        reason: "Relocating",
        effectiveDate: "2026-11-01",
      });

      const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
      expect(body.external_school_name).toBe("Another School");
      expect(body).not.toHaveProperty("to_campus_id");
    });
  });

  it("approveTransfer posts with no body and the given idempotency key", async () => {
    const { approveTransfer } = await import("../student-transfers-service");
    mockPost.mockResolvedValue({ data: { id: "t1", status: "approved" } });

    await approveTransfer("t1", "key-approve");

    expect(mockPost).toHaveBeenCalledWith(
      "/student-transfers/t1:approve",
      undefined,
      expect.objectContaining({ idempotencyKey: "key-approve" }),
    );
  });

  it("rejectTransfer posts with no body and the given idempotency key", async () => {
    const { rejectTransfer } = await import("../student-transfers-service");
    mockPost.mockResolvedValue({ data: { id: "t1", status: "rejected" } });

    await rejectTransfer("t1", "key-reject");

    expect(mockPost).toHaveBeenCalledWith(
      "/student-transfers/t1:reject",
      undefined,
      expect.objectContaining({ idempotencyKey: "key-reject" }),
    );
  });

  describe("completeTransfer", () => {
    it("posts section_id when given", async () => {
      const { completeTransfer } = await import("../student-transfers-service");
      mockPost.mockResolvedValue({ data: { id: "t1", status: "completed" } });

      await completeTransfer("t1", { sectionId: "sec-1" }, "key-complete");

      expect(mockPost).toHaveBeenCalledWith(
        "/student-transfers/t1:complete",
        { section_id: "sec-1" },
        expect.objectContaining({ idempotencyKey: "key-complete" }),
      );
    });

    it("posts an empty body when no section is given", async () => {
      const { completeTransfer } = await import("../student-transfers-service");
      mockPost.mockResolvedValue({ data: { id: "t1" } });

      await completeTransfer("t1", {}, "key-complete-2");

      expect(mockPost).toHaveBeenCalledWith(
        "/student-transfers/t1:complete",
        {},
        expect.objectContaining({ idempotencyKey: "key-complete-2" }),
      );
    });
  });
});
