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

describe("curriculum-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  describe("fetchCurriculumPage", () => {
    it("lists /class-subjects, mapping every filter to its snake_case query param", async () => {
      const { fetchCurriculumPage } = await import("../curriculum-service");
      mockGet.mockResolvedValue({ data: [{ id: "cs1" }], meta: PAGE_META });

      const result = await fetchCurriculumPage({
        page: 2,
        pageSize: 25,
        search: "math",
        ordering: "-weekly_periods",
        academicSessionId: "sess-1",
        classId: "class-1",
        campusId: "campus-1",
        isElective: true,
      });

      expect(mockGet).toHaveBeenCalledWith(
        "/class-subjects",
        expect.objectContaining({
          query: {
            page: 2,
            page_size: 25,
            search: "math",
            ordering: "-weekly_periods",
            academic_session_id: "sess-1",
            class_id: "class-1",
            campus_id: "campus-1",
            is_elective: true,
          },
        }),
      );
      expect(result.items).toEqual([{ id: "cs1" }]);
      expect(result.pagination).toEqual(PAGE_META.pagination);
    });

    it("omits unset and empty filters but keeps is_elective=false", async () => {
      const { fetchCurriculumPage } = await import("../curriculum-service");
      mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

      await fetchCurriculumPage({
        page: 1,
        pageSize: 10,
        search: "",
        academicSessionId: "sess-1",
        isElective: false,
      });

      const [, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
      expect(options.query).toEqual({
        page: 1,
        page_size: 10,
        academic_session_id: "sess-1",
        is_elective: false,
      });
      expect(options.query).not.toHaveProperty("search");
      expect(options.query).not.toHaveProperty("class_id");
      expect(options.query).not.toHaveProperty("campus_id");
    });
  });

  describe("fetchCurriculumForClass", () => {
    it("fetches one MAX_PAGE_SIZE page scoped to the session and class", async () => {
      const { fetchCurriculumForClass } = await import("../curriculum-service");
      mockGet.mockResolvedValue({ data: [{ id: "cs1" }, { id: "cs2" }], meta: {} });

      const result = await fetchCurriculumForClass("sess-1", "class-1");

      expect(mockGet).toHaveBeenCalledWith(
        "/class-subjects",
        expect.objectContaining({
          query: { academic_session_id: "sess-1", class_id: "class-1", page_size: 100 },
        }),
      );
      expect(result).toEqual([{ id: "cs1" }, { id: "cs2" }]);
    });
  });

  describe("createCurriculum", () => {
    it("posts the snake_case body, sending campus_id: null for all campuses", async () => {
      const { createCurriculum } = await import("../curriculum-service");
      mockPost.mockResolvedValue({ data: { id: "cs1" } });

      const result = await createCurriculum({
        academicSessionId: "sess-1",
        classId: "class-1",
        subjectId: "subject-1",
        campusId: null,
        isElective: false,
        electiveGroup: null,
        weeklyPeriods: 5,
        notes: null,
      });

      expect(mockPost).toHaveBeenCalledWith("/class-subjects", {
        academic_session_id: "sess-1",
        class_id: "class-1",
        subject_id: "subject-1",
        campus_id: null,
        is_elective: false,
        elective_group: null,
        weekly_periods: 5,
        notes: null,
      });
      expect(result).toEqual({ id: "cs1" });
    });
  });

  describe("updateCurriculum", () => {
    it("patches the detail path with only the fields given", async () => {
      const { updateCurriculum } = await import("../curriculum-service");
      mockPatch.mockResolvedValue({ data: { id: "cs1", weekly_periods: 6 } });

      await updateCurriculum("cs1", { weeklyPeriods: 6, notes: null });

      expect(mockPatch).toHaveBeenCalledWith("/class-subjects/cs1", {
        weekly_periods: 6,
        notes: null,
      });
    });

    it("sends is_elective: false and a cleared elective_group, not dropping them", async () => {
      const { updateCurriculum } = await import("../curriculum-service");
      mockPatch.mockResolvedValue({ data: { id: "cs1" } });

      await updateCurriculum("cs1", { isElective: false, electiveGroup: null });

      expect(mockPatch).toHaveBeenCalledWith("/class-subjects/cs1", {
        is_elective: false,
        elective_group: null,
      });
    });
  });

  describe("deleteCurriculum", () => {
    it("deletes the detail path and resolves with nothing", async () => {
      const { deleteCurriculum } = await import("../curriculum-service");
      mockDelete.mockResolvedValue({ data: null });

      await expect(deleteCurriculum("cs1")).resolves.toBeUndefined();

      expect(mockDelete).toHaveBeenCalledWith("/class-subjects/cs1");
    });
  });

  describe("cloneCurriculum", () => {
    it("posts to the colon-action with both session ids and the idempotency key", async () => {
      const { cloneCurriculum } = await import("../curriculum-service");
      mockPost.mockResolvedValue({ data: { created: 12, skipped: 3 } });

      const result = await cloneCurriculum("sess-old", "sess-new", "key-clone");

      expect(mockPost).toHaveBeenCalledWith(
        "/class-subjects:clone",
        { source_academic_session_id: "sess-old", target_academic_session_id: "sess-new" },
        expect.objectContaining({ idempotencyKey: "key-clone" }),
      );
      expect(result).toEqual({ created: 12, skipped: 3 });
    });
  });
});
