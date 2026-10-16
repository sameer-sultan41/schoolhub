import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";
import type { PromotionTransition } from "../promotions-type";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

const PAGE_META = { pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 } };

describe("promotions-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  describe("fetchPromotionBatches", () => {
    it("lists /student-promotions, mapping each filter to its snake_case param", async () => {
      const { fetchPromotionBatches } = await import("../promotions-service");
      mockGet.mockResolvedValue({ data: [{ batch_id: "b1" }], meta: PAGE_META });

      const result = await fetchPromotionBatches({
        page: 2,
        pageSize: 25,
        ordering: "-students",
        status: "pending_approval",
        fromAcademicSessionId: "sess-1",
        fromClassId: "class-1",
      });

      expect(mockGet).toHaveBeenCalledWith(
        "/student-promotions",
        expect.objectContaining({
          query: {
            page: 2,
            page_size: 25,
            ordering: "-students",
            status: "pending_approval",
            from_academic_session_id: "sess-1",
            from_class_id: "class-1",
          },
        }),
      );
      expect(result.items).toEqual([{ batch_id: "b1" }]);
      expect(result.pagination).toEqual(PAGE_META.pagination);
    });

    it("omits unset and empty filters", async () => {
      const { fetchPromotionBatches } = await import("../promotions-service");
      mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

      await fetchPromotionBatches({ page: 1, pageSize: 10, status: "", fromClassId: "" });

      const [, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
      expect(options.query).toEqual({ page: 1, page_size: 10 });
      expect(options.query).not.toHaveProperty("ordering");
      expect(options.query).not.toHaveProperty("status");
      expect(options.query).not.toHaveProperty("from_academic_session_id");
      expect(options.query).not.toHaveProperty("from_class_id");
    });
  });

  describe("fetchPromotionBatch", () => {
    it("gets the batch detail path and resolves with the unwrapped batch", async () => {
      const { fetchPromotionBatch } = await import("../promotions-service");
      const batch = { batch_id: "b1", decisions: [{ student_id: "s1" }] };
      mockGet.mockResolvedValue({ data: batch });

      const result = await fetchPromotionBatch("b1");

      expect(mockGet).toHaveBeenCalledWith("/student-promotions/b1");
      expect(result).toEqual(batch);
    });
  });

  describe("createPromotionBatch", () => {
    it("posts the snake_case body to the list path, with no idempotency option", async () => {
      const { createPromotionBatch } = await import("../promotions-service");
      mockPost.mockResolvedValue({ data: { batch_id: "b1", students: 30 } });

      const result = await createPromotionBatch({
        fromAcademicSessionId: "sess-old",
        toAcademicSessionId: "sess-new",
        classId: "class-1",
      });

      expect(mockPost).toHaveBeenCalledWith("/student-promotions", {
        from_academic_session_id: "sess-old",
        to_academic_session_id: "sess-new",
        class_id: "class-1",
      });
      expect(mockPost.mock.calls[0]).toHaveLength(2);
      expect(result).toEqual({ batch_id: "b1", students: 30 });
    });
  });

  describe("updateDecision", () => {
    it("patches the decision path with only the fields given", async () => {
      const { updateDecision } = await import("../promotions-service");
      mockPatch.mockResolvedValue({ data: { student_id: "s1", decision: "retained" } });

      const result = await updateDecision("b1", "s1", {
        decision: "retained",
        toClassId: "class-1",
        overrideReason: "Repeating the year.",
      });

      expect(mockPatch).toHaveBeenCalledWith("/student-promotions/b1/decisions/s1", {
        decision: "retained",
        to_class_id: "class-1",
        override_reason: "Repeating the year.",
      });
      expect(result).toEqual({ student_id: "s1", decision: "retained" });
    });

    it("sends a null target, reason and remarks, not dropping them", async () => {
      const { updateDecision } = await import("../promotions-service");
      mockPatch.mockResolvedValue({ data: { student_id: "s1" } });

      await updateDecision("b1", "s1", {
        decision: "graduated",
        toClassId: null,
        toSectionId: null,
        overrideReason: null,
        remarks: null,
      });

      expect(mockPatch).toHaveBeenCalledWith("/student-promotions/b1/decisions/s1", {
        decision: "graduated",
        to_class_id: null,
        to_section_id: null,
        override_reason: null,
        remarks: null,
      });
    });
  });

  describe("transitionBatch", () => {
    it.each<PromotionTransition>(["submit", "approve", "reject", "revert"])(
      "posts :%s with no body and the given idempotency key",
      async (action) => {
        const { transitionBatch } = await import("../promotions-service");
        mockPost.mockResolvedValue({ data: { updated: 30 } });

        const result = await transitionBatch("b1", action, `key-${action}`);

        expect(mockPost).toHaveBeenCalledWith(
          `/student-promotions/b1:${action}`,
          undefined,
          expect.objectContaining({ idempotencyKey: `key-${action}` }),
        );
        expect(result).toEqual({ updated: 30 });
      },
    );
  });

  describe("executeBatch", () => {
    it("posts :execute with no body and the key, resolving with the accepted job", async () => {
      const { executeBatch } = await import("../promotions-service");
      mockPost.mockResolvedValue({ data: { job_id: "job-1", status: "queued" } });

      const result = await executeBatch("b1", "key-execute");

      expect(mockPost).toHaveBeenCalledWith(
        "/student-promotions/b1:execute",
        undefined,
        expect.objectContaining({ idempotencyKey: "key-execute" }),
      );
      expect(result).toEqual({ job_id: "job-1", status: "queued" });
    });
  });
});
