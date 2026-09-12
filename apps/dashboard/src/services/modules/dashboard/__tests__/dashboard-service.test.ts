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

      expect(mockGet).toHaveBeenCalledWith("/staff", { query: { page_size: 100 } });
      expect(result).toEqual(staff);
    });
  });

  describe("fetchStaffPage", () => {
    it("passes page, page size, search, ordering and employment status through to /staff and returns the page envelope", async () => {
      const { fetchStaffPage } = await import("../dashboard-service");
      const staff = [
        {
          id: "st-1",
          first_name: "Ayesha",
          last_name: "Khan",
          designation_name: "Head Teacher",
          department_name: "Academics",
          campus_name: "Main Campus",
          staff_type: "teaching",
          employment_status: "active",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ];
      mockGet.mockResolvedValue({
        data: staff,
        meta: { pagination: { page: 2, page_size: 10, total_count: 23, total_pages: 3 } },
      });

      const result = await fetchStaffPage({
        page: 2,
        pageSize: 10,
        search: "khan",
        ordering: "-last_name",
        employmentStatus: "active",
      });

      expect(mockGet).toHaveBeenCalledWith("/staff", {
        query: {
          page: 2,
          page_size: 10,
          search: "khan",
          ordering: "-last_name",
          employment_status: "active",
        },
      });
      expect(result).toEqual({
        items: staff,
        pagination: { page: 2, page_size: 10, total_count: 23, total_pages: 3 },
      });
    });

    it("omits page, search, ordering and employment status from the query when not given", async () => {
      const { fetchStaffPage } = await import("../dashboard-service");
      mockGet.mockResolvedValue({ data: [], meta: {} });

      await fetchStaffPage();

      expect(mockGet).toHaveBeenCalledWith("/staff", { query: { page_size: 25 } });
    });
  });

  describe("fetchStaffTypeCount", () => {
    it("reads the teaching headcount from /staff's own total_count", async () => {
      const { fetchStaffTypeCount } = await import("../dashboard-service");
      mockGet.mockResolvedValue({
        data: rows(1),
        meta: { pagination: { page: 1, page_size: 1, total_count: 42, total_pages: 42 } },
      });

      const result = await fetchStaffTypeCount("teaching");

      expect(mockGet).toHaveBeenCalledWith("/staff", {
        query: { staff_type: "teaching", page_size: 1 },
      });
      expect(result).toBe(42);
    });

    it("reports the headcount as null rather than a fabricated zero when the endpoint omits a total", async () => {
      const { fetchStaffTypeCount } = await import("../dashboard-service");
      mockGet.mockResolvedValue({ data: rows(0), meta: {} });

      const result = await fetchStaffTypeCount("non_teaching");

      expect(result).toBeNull();
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

  describe("createStaff", () => {
    it("posts to /staff with a snake_cased body containing only the given optional fields", async () => {
      const { createStaff } = await import("../dashboard-service");
      const created = {
        id: "st-1",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: null,
        department_name: null,
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "active",
        updated_at: "2026-09-01T00:00:00Z",
      };
      mockPost.mockResolvedValue({ data: created });

      const result = await createStaff({
        campusId: "campus-1",
        joiningDate: "2026-09-01",
        firstName: "Ayesha",
        lastName: "Khan",
        staffType: "teaching",
        phone: "+92-300-0000000",
        departmentId: "dept-1",
        email: "ayesha@example.com",
        // designationId, reportsToStaffId, userId, photoFileId, gender, dateOfBirth,
        // employmentType, nationalId, publicBio and address are all left out.
      });

      expect(mockPost).toHaveBeenCalledWith("/staff", {
        campus_id: "campus-1",
        joining_date: "2026-09-01",
        first_name: "Ayesha",
        last_name: "Khan",
        staff_type: "teaching",
        phone: "+92-300-0000000",
        department_id: "dept-1",
        email: "ayesha@example.com",
      });
      expect(result).toEqual(created);
    });
  });

  describe("updateStaff", () => {
    it("patches /staff/{id} with only the changed fields", async () => {
      const { updateStaff } = await import("../dashboard-service");
      const updated = {
        id: "st-1",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: "Head Teacher",
        department_name: "Academics",
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "active",
        updated_at: "2026-09-02T00:00:00Z",
      };
      mockPatch.mockResolvedValue({ data: updated });

      const result = await updateStaff("st-1", {
        phone: "+92-300-1111111",
        designationId: "des-2",
      });

      expect(mockPatch).toHaveBeenCalledWith("/staff/st-1", {
        phone: "+92-300-1111111",
        designation_id: "des-2",
      });
      expect(result).toEqual(updated);
    });
  });

  describe("exitStaff", () => {
    it("posts to /staff/{id}:exit and omits exitType from the body when not given", async () => {
      const { exitStaff } = await import("../dashboard-service");
      const exited = {
        id: "st-1",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: "Head Teacher",
        department_name: "Academics",
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "resigned",
        updated_at: "2026-09-10T00:00:00Z",
        exit_date: "2026-09-10",
        exit_reason: "Relocating",
      };
      mockPost.mockResolvedValue({ data: exited });

      const result = await exitStaff("st-1", {
        exitDate: "2026-09-10",
        exitReason: "Relocating",
      });

      expect(mockPost).toHaveBeenCalledWith("/staff/st-1:exit", {
        exit_date: "2026-09-10",
        exit_reason: "Relocating",
      });
      const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
      expect(body).not.toHaveProperty("exit_type");
      expect(result).toEqual(exited);
    });

    it("sends exitType when explicitly given", async () => {
      const { exitStaff } = await import("../dashboard-service");
      mockPost.mockResolvedValue({
        data: { id: "st-1", exit_date: "2026-09-10", exit_reason: "Retired" },
      });

      await exitStaff("st-1", {
        exitDate: "2026-09-10",
        exitReason: "Retired",
        exitType: "retired",
      });

      expect(mockPost).toHaveBeenCalledWith("/staff/st-1:exit", {
        exit_date: "2026-09-10",
        exit_reason: "Retired",
        exit_type: "retired",
      });
    });
  });

  describe("fetchStaffById", () => {
    it("reads the full staff record from /staff/{id}", async () => {
      const { fetchStaffById } = await import("../dashboard-service");
      const detail = {
        id: "st-1",
        employee_number: "EMP-001",
        first_name: "Ayesha",
        last_name: "Khan",
        gender: "female",
        date_of_birth: "1990-01-01",
        photo_file_id: null,
        staff_type: "teaching",
        campus_id: "cmp-1",
        department_id: "dep-1",
        designation_id: "des-1",
        reports_to_staff_id: null,
        employment_type: "full_time",
        employment_status: "active",
        joining_date: "2020-01-01",
        email: "ayesha@example.test",
        phone: "+92000000000",
        national_id: null,
        public_bio: null,
        address: null,
      };
      mockGet.mockResolvedValue({ data: detail });

      const result = await fetchStaffById("st-1");

      expect(mockGet).toHaveBeenCalledWith("/staff/st-1");
      expect(result).toEqual(detail);
    });
  });
});
