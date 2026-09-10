import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
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
  });

  describe("fetchDashboardOverview", () => {
    it("reads the two head counts from the server's own total and counts the four bounded lists", async () => {
      const { fetchDashboardOverview } = await import("../dashboard-service");
      mockGet.mockImplementation((path: string) => {
        if (path === "/students") {
          return Promise.resolve({
            data: rows(1),
            meta: { pagination: { page: 1, page_size: 1, total_count: 1280, total_pages: 1280 } },
          });
        }
        if (path === "/staff") {
          return Promise.resolve({
            data: rows(1),
            meta: { pagination: { page: 1, page_size: 1, total_count: 97, total_pages: 97 } },
          });
        }
        if (path === "/classes") return Promise.resolve({ data: rows(12), meta: {} });
        if (path === "/sections") return Promise.resolve({ data: rows(34), meta: {} });
        if (path === "/subjects") return Promise.resolve({ data: rows(8), meta: {} });
        return Promise.resolve({ data: rows(3), meta: {} }); // /campuses
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
      expect(mockGet).toHaveBeenCalledWith("/students", { query: { page_size: 1 } });
      expect(mockGet).toHaveBeenCalledWith("/staff", { query: { page_size: 1 } });
      expect(mockGet).toHaveBeenCalledWith("/classes", { query: { page_size: 25 } });
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

  describe("fetchStaffDirectory", () => {
    it("drains the staff list", async () => {
      const { fetchStaffDirectory } = await import("../dashboard-service");
      const staff = [
        {
          id: "st-1",
          first_name: "Ayesha",
          last_name: "Khan",
          designation_name: "Head Teacher",
          staff_type: "teaching",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ];
      mockGet.mockResolvedValue({ data: staff, meta: {} });

      const result = await fetchStaffDirectory();

      expect(mockGet).toHaveBeenCalledWith("/staff", { query: { page_size: 25 } });
      expect(result).toEqual(staff);
    });
  });
});
