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

describe("students-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("fetchStudentsPage sends filters as snake_case query params", async () => {
    const { fetchStudentsPage } = await import("../students-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } },
    });

    await fetchStudentsPage({
      page: 1,
      pageSize: 10,
      search: "ali",
      status: "active",
      campusId: "c1",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/students",
      expect.objectContaining({
        query: { page: 1, page_size: 10, search: "ali", status: "active", campus_id: "c1" },
      }),
    );
  });

  it("createStudent maps camelCase input to the snake_case request body", async () => {
    const { createStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "s1" } });

    await createStudent({
      firstName: "Ali",
      lastName: "Khan",
      dateOfBirth: "2012-05-01",
      gender: "male",
      campusId: "c1",
      admissionDate: "2026-01-10",
    });

    expect(mockPost).toHaveBeenCalledWith("/students", {
      first_name: "Ali",
      last_name: "Khan",
      date_of_birth: "2012-05-01",
      gender: "male",
      campus_id: "c1",
      admission_date: "2026-01-10",
    });
  });

  it("updateStudent sends null (not omitted) for an explicitly cleared house", async () => {
    const { updateStudent } = await import("../students-service");
    mockPatch.mockResolvedValue({ data: { id: "s1" } });

    await updateStudent("s1", { houseId: null });

    expect(mockPatch).toHaveBeenCalledWith("/students/s1", { house_id: null });
  });

  it("withdrawStudent posts to the colon-action path with an Idempotency-Key", async () => {
    const { withdrawStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "s1", status: "withdrawn" } });

    await withdrawStudent("s1", { reason: "Relocated", effectiveDate: "2026-02-01" }, "key-abc");

    expect(mockPost).toHaveBeenCalledWith(
      "/students/s1:withdraw",
      { reason: "Relocated", effective_date: "2026-02-01", waive_clearance: false },
      expect.objectContaining({ idempotencyKey: "key-abc" }),
    );
  });
});
