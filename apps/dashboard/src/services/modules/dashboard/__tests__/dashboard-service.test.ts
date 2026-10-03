import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

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

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `id-${String(index)}` }));
}

describe("DashboardService", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  describe("fetchDashboardOverview", () => {
    it("reads all six counts from the server's own total_count — never drains a list to count it", async () => {
      const { fetchDashboardOverview } = await import("../dashboard-service");
      const totalCountByPath: Record<string, number> = {
        "/students": 1280,
        "/staff": 97,
        "/classes": 12,
        "/sections": 34,
        "/subjects": 8,
        "/campuses": 3,
      };
      mockGet.mockImplementation((path: string) => {
        const total_count = totalCountByPath[path];
        return Promise.resolve({
          data: rows(1),
          meta: { pagination: { page: 1, page_size: 1, total_count, total_pages: total_count } },
        });
      });

      const overview = await fetchDashboardOverview();

      expect(overview).toEqual({
        students: 1280,
        staff: 97,
        classes: 12,
        sections: 34,
        subjects: 8,
        campuses: 3,
      });
      for (const path of Object.keys(totalCountByPath)) {
        expect(mockGet).toHaveBeenCalledWith(path, { query: { page_size: 1 } });
      }
    });

    it("reports a head count as null rather than a fabricated zero when the endpoint omits a total", async () => {
      const { fetchDashboardOverview } = await import("../dashboard-service");
      mockGet.mockImplementation((path: string) => {
        if (path === "/students") {
          // A cursor envelope with no total_count at all — counting is opt-in per
          // cursor endpoint.
          return Promise.resolve({
            data: rows(1),
            meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 1 } },
          });
        }
        return Promise.resolve({ data: rows(0), meta: {} });
      });

      const overview = await fetchDashboardOverview();

      expect(overview.students).toBeNull();
    });
  });

  describe("fetchAcademicSessions", () => {
    it("drains the academic-sessions list", async () => {
      const { fetchAcademicSessions } = await import("../dashboard-service");
      const sessions = [{ id: "s1", name: "2026-27", status: "active", is_current: true }];
      mockGet.mockResolvedValue({ data: sessions, meta: {} });

      const result = await fetchAcademicSessions();

      expect(mockGet).toHaveBeenCalledWith("/academic-sessions", { query: { page_size: 25 } });
      expect(result).toEqual(sessions);
    });
  });

  describe("fetchTeacherLoadSummary", () => {
    it("passes the academic session id as a query parameter", async () => {
      const { fetchTeacherLoadSummary } = await import("../dashboard-service");
      const load = [
        {
          staff_id: "s1",
          name: "Ayesha Khan",
          weekly_periods: 18,
          allocations: 4,
          over_norm: false,
        },
      ];
      mockGet.mockResolvedValue({ data: load });

      const result = await fetchTeacherLoadSummary("sess-1");

      expect(mockGet).toHaveBeenCalledWith("/teacher-subject-allocations/load-summary", {
        query: { academic_session_id: "sess-1" },
      });
      expect(result).toEqual(load);
    });
  });

  describe("fetchMyTimetable", () => {
    it("returns the slot list directly — the endpoint's data IS the array, not {slots}", async () => {
      const { fetchMyTimetable } = await import("../dashboard-service");
      const slots = [
        {
          id: "slot-1",
          day_of_week: 2,
          start_time: "09:00:00",
          end_time: "09:45:00",
          section_name: "Grade 5-A",
          subject_name: "Mathematics",
          staff_name: "Ayesha Khan",
          room_name: "Room 12",
        },
      ];
      mockGet.mockResolvedValue({
        data: slots,
        meta: { academic_session_id: "sess-1", date: "2026-09-09", audience: "teacher" },
      });

      const result = await fetchMyTimetable("2026-09-09");

      expect(mockGet).toHaveBeenCalledWith("/timetables/my", { query: { date: "2026-09-09" } });
      expect(result).toEqual(slots);
    });
  });

  describe("fetchCampuses", () => {
    it("returns every campus as selectable options, capped at 100", async () => {
      const { fetchCampuses } = await import("../dashboard-service");
      const campuses = [
        { id: "c1", name: "Main Campus" },
        { id: "c2", name: "North Campus" },
      ];
      mockGet.mockResolvedValue({ data: campuses, meta: {} });

      const result = await fetchCampuses();

      expect(mockGet).toHaveBeenCalledWith("/campuses", { query: { page_size: 100 } });
      expect(result).toEqual(campuses);
    });
  });

  describe("fetchDepartments", () => {
    it("returns every department as selectable options, capped at 100", async () => {
      const { fetchDepartments } = await import("../dashboard-service");
      const departments = [
        { id: "d1", name: "Academics" },
        { id: "d2", name: "Administration" },
      ];
      mockGet.mockResolvedValue({ data: departments, meta: {} });

      const result = await fetchDepartments();

      expect(mockGet).toHaveBeenCalledWith("/departments", { query: { page_size: 100 } });
      expect(result).toEqual(departments);
    });
  });

  describe("fetchDesignations", () => {
    it("returns every designation as selectable options, capped at 100", async () => {
      const { fetchDesignations } = await import("../dashboard-service");
      const designations = [
        { id: "des1", name: "Head Teacher" },
        { id: "des2", name: "Assistant Teacher" },
      ];
      mockGet.mockResolvedValue({ data: designations, meta: {} });

      const result = await fetchDesignations();

      expect(mockGet).toHaveBeenCalledWith("/designations", { query: { page_size: 100 } });
      expect(result).toEqual(designations);
    });
  });
});
