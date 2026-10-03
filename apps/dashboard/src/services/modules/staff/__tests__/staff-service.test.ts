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

describe("StaffService", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  describe("fetchStaffDirectory", () => {
    it("drains the staff list", async () => {
      const { fetchStaffDirectory } = await import("../staff-service");
      const staff = [
        {
          id: "st-1",
          first_name: "Ayesha",
          last_name: "Khan",
          designation_name: "Head Teacher",
          staff_type: "teaching",
          updated_at: "2026-09-01T00:00:00Z",
          photo_url: null,
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
      const { fetchStaffPage } = await import("../staff-service");
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
          photo_url: null,
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
      const { fetchStaffPage } = await import("../staff-service");
      mockGet.mockResolvedValue({ data: [], meta: {} });

      await fetchStaffPage();

      expect(mockGet).toHaveBeenCalledWith("/staff", { query: { page_size: 25 } });
    });
  });

  describe("fetchStaffTypeCount", () => {
    it("reads the teaching headcount from /staff's own total_count", async () => {
      const { fetchStaffTypeCount } = await import("../staff-service");
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
      const { fetchStaffTypeCount } = await import("../staff-service");
      mockGet.mockResolvedValue({ data: rows(0), meta: {} });

      const result = await fetchStaffTypeCount("non_teaching");

      expect(result).toBeNull();
    });
  });

  describe("createStaff", () => {
    it("posts to /staff with a snake_cased body containing only the given optional fields", async () => {
      const { createStaff } = await import("../staff-service");
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
        photo_url: null,
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

    it("includes every optional field when the caller provides all of them", async () => {
      const { createStaff } = await import("../staff-service");
      mockPost.mockResolvedValue({ data: {} });

      await createStaff({
        campusId: "campus-1",
        joiningDate: "2026-09-01",
        firstName: "Ayesha",
        lastName: "Khan",
        staffType: "teaching",
        phone: "+92-300-0000000",
        departmentId: "dept-1",
        designationId: "des-1",
        reportsToStaffId: "staff-1",
        userId: "user-1",
        photoFileId: "file-1",
        gender: "female",
        dateOfBirth: "1990-01-01",
        employmentType: "full_time",
        email: "ayesha@example.com",
        nationalId: "12345",
        publicBio: "Bio",
        address: { line1: "1 Main St" },
      });

      expect(mockPost).toHaveBeenCalledWith(
        "/staff",
        expect.objectContaining({
          department_id: "dept-1",
          designation_id: "des-1",
          reports_to_staff_id: "staff-1",
          user_id: "user-1",
          photo_file_id: "file-1",
          gender: "female",
          date_of_birth: "1990-01-01",
          employment_type: "full_time",
          national_id: "12345",
          public_bio: "Bio",
          address: { line1: "1 Main St" },
        }),
      );
    });

    // Root cause: createStaff used to truthy-gate its optional fields, silently
    // dropping an explicit `null` for a nullable relation — unlike updateStaff's own
    // `!== undefined` gating for the identical field. Fixed so both agree.
    it("sends an explicit null for a cleared relation field, not dropping it", async () => {
      const { createStaff } = await import("../staff-service");
      mockPost.mockResolvedValue({ data: {} });

      await createStaff({
        campusId: "campus-1",
        joiningDate: "2026-09-01",
        firstName: "Ayesha",
        lastName: "Khan",
        staffType: "teaching",
        phone: "+92-300-0000000",
        departmentId: null,
      });

      expect(mockPost).toHaveBeenCalledWith(
        "/staff",
        expect.objectContaining({ department_id: null }),
      );
    });
  });

  describe("updateStaff", () => {
    it("patches /staff/{id} with only the changed fields", async () => {
      const { updateStaff } = await import("../staff-service");
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
        photo_url: null,
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

    it("includes every required-ish and optional field when the caller provides all of them", async () => {
      const { updateStaff } = await import("../staff-service");
      mockPatch.mockResolvedValue({ data: {} });

      await updateStaff("st-1", {
        campusId: "campus-2",
        joiningDate: "2026-09-02",
        firstName: "Ayesha",
        lastName: "Siddiqui",
        staffType: "non_teaching",
        phone: "+92-300-2222222",
        departmentId: "dept-2",
        designationId: "des-2",
        reportsToStaffId: "staff-2",
        userId: "user-2",
        photoFileId: "file-2",
        gender: "female",
        dateOfBirth: "1990-01-01",
        employmentType: "part_time",
        email: "ayesha@example.com",
        nationalId: "54321",
        publicBio: "Bio",
        address: { line1: "2 Main St" },
      });

      expect(mockPatch).toHaveBeenCalledWith(
        "/staff/st-1",
        expect.objectContaining({
          campus_id: "campus-2",
          joining_date: "2026-09-02",
          first_name: "Ayesha",
          last_name: "Siddiqui",
          staff_type: "non_teaching",
          department_id: "dept-2",
          designation_id: "des-2",
          reports_to_staff_id: "staff-2",
          user_id: "user-2",
          photo_file_id: "file-2",
          gender: "female",
          date_of_birth: "1990-01-01",
          employment_type: "part_time",
          email: "ayesha@example.com",
          national_id: "54321",
          public_bio: "Bio",
          address: { line1: "2 Main St" },
        }),
      );
    });

    it("sends an empty body when nothing, not even phone, has changed", async () => {
      const { updateStaff } = await import("../staff-service");
      mockPatch.mockResolvedValue({ data: {} });

      await updateStaff("st-1", {});

      expect(mockPatch).toHaveBeenCalledWith("/staff/st-1", {});
    });
  });

  describe("exitStaff", () => {
    it("posts to /staff/{id}:exit and omits exitType from the body when not given", async () => {
      const { exitStaff } = await import("../staff-service");
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
        photo_url: null,
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
      const { exitStaff } = await import("../staff-service");
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
      const { fetchStaffById } = await import("../staff-service");
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
