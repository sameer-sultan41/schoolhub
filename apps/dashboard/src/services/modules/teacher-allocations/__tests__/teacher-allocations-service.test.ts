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

const PAGE_META = { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } };
const WARNING = { code: "teacher_over_norm", staff_id: "staff-1", weekly_periods: 34, norm: 30 };

/** The body a PATCH was sent, so a test can prove which keys it carried. */
function patchedBody(): Record<string, unknown> {
  const [, body] = mockPatch.mock.calls[0] as [string, Record<string, unknown>];
  return body;
}

describe("teacher-allocations-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  describe("fetchAllocationsPage", () => {
    it("lists /teacher-subject-allocations, mapping every filter to its snake_case query param", async () => {
      const { fetchAllocationsPage } = await import("../teacher-allocations-service");
      mockGet.mockResolvedValue({ data: [{ id: "a1" }], meta: PAGE_META });

      const result = await fetchAllocationsPage({
        page: 2,
        pageSize: 25,
        search: "khan",
        ordering: "-weekly_periods",
        academicSessionId: "sess-1",
        classId: "class-1",
        sectionId: "section-1",
        subjectId: "subject-1",
        staffId: "staff-1",
        current: true,
      });

      expect(mockGet).toHaveBeenCalledWith(
        "/teacher-subject-allocations",
        expect.objectContaining({
          query: {
            page: 2,
            page_size: 25,
            search: "khan",
            ordering: "-weekly_periods",
            academic_session_id: "sess-1",
            class_id: "class-1",
            section_id: "section-1",
            subject_id: "subject-1",
            staff_id: "staff-1",
            current: true,
          },
        }),
      );
      expect(result.items).toEqual([{ id: "a1" }]);
      expect(result.pagination).toEqual(PAGE_META.pagination);
    });

    it("omits unset and empty filters but keeps current=false (the ended allocations)", async () => {
      const { fetchAllocationsPage } = await import("../teacher-allocations-service");
      mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

      await fetchAllocationsPage({
        page: 1,
        pageSize: 10,
        search: "",
        academicSessionId: "sess-1",
        classId: "",
        current: false,
      });

      const [, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
      expect(options.query).toEqual({
        page: 1,
        page_size: 10,
        academic_session_id: "sess-1",
        current: false,
      });
      expect(options.query).not.toHaveProperty("search");
      expect(options.query).not.toHaveProperty("class_id");
      expect(options.query).not.toHaveProperty("section_id");
      expect(options.query).not.toHaveProperty("staff_id");
    });
  });

  describe("allocateTeacher", () => {
    const INPUT = {
      academicSessionId: "sess-1",
      sectionId: "section-1",
      subjectId: "subject-1",
      staffId: "staff-1",
      isPrimary: true,
      weeklyPeriods: 4,
      effectiveFrom: "2026-09-01",
    };

    it("posts the snake_case body to the collection and never sends effective_to", async () => {
      const { allocateTeacher } = await import("../teacher-allocations-service");
      mockPost.mockResolvedValue({ data: { id: "a1" }, meta: { warnings: [] } });

      await allocateTeacher(INPUT);

      expect(mockPost).toHaveBeenCalledWith("/teacher-subject-allocations", {
        academic_session_id: "sess-1",
        section_id: "section-1",
        subject_id: "subject-1",
        staff_id: "staff-1",
        is_primary: true,
        weekly_periods: 4,
        effective_from: "2026-09-01",
      });
      // A create is never sent `effective_to`: the server refuses a date there.
      const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
      expect(body).not.toHaveProperty("effective_to");
    });

    it("sends null for no weekly-periods override and no start date, and is_primary: false", async () => {
      const { allocateTeacher } = await import("../teacher-allocations-service");
      mockPost.mockResolvedValue({ data: { id: "a1" }, meta: {} });

      await allocateTeacher({
        ...INPUT,
        isPrimary: false,
        weeklyPeriods: null,
        effectiveFrom: null,
      });

      expect(mockPost).toHaveBeenCalledWith(
        "/teacher-subject-allocations",
        expect.objectContaining({ is_primary: false, weekly_periods: null, effective_from: null }),
      );
    });

    it("resolves with the allocation and the over-norm warnings from meta", async () => {
      const { allocateTeacher } = await import("../teacher-allocations-service");
      mockPost.mockResolvedValue({
        data: { id: "a1", staff_id: "staff-1" },
        meta: { warnings: [WARNING], request_id: "req-1" },
      });

      const result = await allocateTeacher(INPUT);

      expect(result).toEqual({
        allocation: { id: "a1", staff_id: "staff-1" },
        warnings: [WARNING],
      });
    });

    it.each<[string, Record<string, unknown> | undefined]>([
      ["an empty warnings list", { warnings: [] }],
      ["a meta without warnings", {}],
      ["no meta at all", undefined],
    ])("resolves with no warnings for %s", async (_label, meta) => {
      const { allocateTeacher } = await import("../teacher-allocations-service");
      mockPost.mockResolvedValue({ data: { id: "a1" }, meta });

      const result = await allocateTeacher(INPUT);

      expect(result).toEqual({ allocation: { id: "a1" }, warnings: [] });
    });
  });

  describe("updateAllocation", () => {
    it("patches the detail path with only the fields given", async () => {
      const { updateAllocation } = await import("../teacher-allocations-service");
      mockPatch.mockResolvedValue({ data: { id: "a1" }, meta: { warnings: [] } });

      await updateAllocation("a1", { isPrimary: false, effectiveFrom: "2026-09-02" });

      expect(mockPatch).toHaveBeenCalledWith("/teacher-subject-allocations/a1", {
        is_primary: false,
        effective_from: "2026-09-02",
      });
      expect(Object.keys(patchedBody()).sort()).toEqual(["effective_from", "is_primary"]);
    });

    it("sends weekly_periods: null to clear the override, not dropping it", async () => {
      const { updateAllocation } = await import("../teacher-allocations-service");
      mockPatch.mockResolvedValue({ data: { id: "a1" }, meta: {} });

      await updateAllocation("a1", { weeklyPeriods: null });

      expect(patchedBody()).toEqual({ weekly_periods: null });
    });

    it("maps effectiveTo to effective_to when an edit sets it", async () => {
      const { updateAllocation } = await import("../teacher-allocations-service");
      mockPatch.mockResolvedValue({ data: { id: "a1" }, meta: {} });

      await updateAllocation("a1", { effectiveTo: "2026-10-01" });

      expect(patchedBody()).toEqual({ effective_to: "2026-10-01" });
    });

    it("resolves with the allocation and the warnings from meta", async () => {
      const { updateAllocation } = await import("../teacher-allocations-service");
      mockPatch.mockResolvedValue({ data: { id: "a1" }, meta: { warnings: [WARNING] } });

      const result = await updateAllocation("a1", { weeklyPeriods: 20 });

      expect(result).toEqual({ allocation: { id: "a1" }, warnings: [WARNING] });
    });

    it("resolves with no warnings when meta is missing", async () => {
      const { updateAllocation } = await import("../teacher-allocations-service");
      mockPatch.mockResolvedValue({ data: { id: "a1" }, meta: undefined });

      const result = await updateAllocation("a1", { isPrimary: true });

      expect(result.warnings).toEqual([]);
    });
  });

  describe("endAllocation", () => {
    it("patches only effective_to with the end date", async () => {
      const { endAllocation } = await import("../teacher-allocations-service");
      mockPatch.mockResolvedValue({ data: { id: "a1" }, meta: { warnings: [] } });

      const result = await endAllocation("a1", "2026-10-14");

      expect(mockPatch).toHaveBeenCalledWith("/teacher-subject-allocations/a1", {
        effective_to: "2026-10-14",
      });
      expect(Object.keys(patchedBody())).toEqual(["effective_to"]);
      expect(result).toEqual({ allocation: { id: "a1" }, warnings: [] });
    });
  });

  describe("reinstateAllocation", () => {
    it("patches only effective_to: null, which makes the allocation current again", async () => {
      const { reinstateAllocation } = await import("../teacher-allocations-service");
      mockPatch.mockResolvedValue({ data: { id: "a1" }, meta: { warnings: [WARNING] } });

      const result = await reinstateAllocation("a1");

      expect(mockPatch).toHaveBeenCalledWith("/teacher-subject-allocations/a1", {
        effective_to: null,
      });
      expect(Object.keys(patchedBody())).toEqual(["effective_to"]);
      expect(result.warnings).toEqual([WARNING]);
    });
  });

  describe("deleteAllocation", () => {
    it("deletes the detail path and resolves with nothing", async () => {
      const { deleteAllocation } = await import("../teacher-allocations-service");
      mockDelete.mockResolvedValue({ data: null });

      await expect(deleteAllocation("a1")).resolves.toBeUndefined();

      expect(mockDelete).toHaveBeenCalledWith("/teacher-subject-allocations/a1");
    });
  });

  describe("fetchLoadSummary", () => {
    it("passes the academic session id as a query parameter and returns the rows", async () => {
      const { fetchLoadSummary } = await import("../teacher-allocations-service");
      const load = [
        {
          staff_id: "s1",
          name: "Ayesha Khan",
          weekly_periods: 18,
          allocations: 4,
          norm: 30,
          over_norm: false,
        },
      ];
      mockGet.mockResolvedValue({ data: load });

      const result = await fetchLoadSummary("sess-1");

      expect(mockGet).toHaveBeenCalledWith("/teacher-subject-allocations/load-summary", {
        query: { academic_session_id: "sess-1" },
      });
      expect(result).toEqual(load);
    });
  });
});
