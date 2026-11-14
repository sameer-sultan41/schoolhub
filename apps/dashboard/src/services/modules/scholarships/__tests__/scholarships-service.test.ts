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

const PAGE = {
  data: [{ id: "x1" }],
  meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
};

describe("scholarships-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listScholarships GETs /scholarships with the filters mapped to the API's names", async () => {
    const { listScholarships } = await import("../scholarships-service");
    mockGet.mockResolvedValue(PAGE);

    await listScholarships({
      studentId: "s1",
      status: "active",
      academicSessionId: "a1",
      scholarshipType: "merit",
      sponsor: "Trust",
      cursor: "c1",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/scholarships",
      expect.objectContaining({
        query: expect.objectContaining({
          student: "s1",
          status: "active",
          academic_session_id: "a1",
          scholarship_type: "merit",
          sponsor: "Trust",
          cursor: "c1",
        }),
      }),
    );
  });

  it("createScholarship POSTs /scholarships with the snake_case body", async () => {
    const { createScholarship } = await import("../scholarships-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createScholarship({
      studentId: "s1",
      academicSessionId: "a1",
      name: "Merit",
      coverageType: "percent",
      value: "50",
      status: "applied",
      sponsor: null,
    });

    expect(mockPost).toHaveBeenCalledWith("/scholarships", {
      student: "s1",
      academic_session: "a1",
      name: "Merit",
      coverage_type: "percent",
      value: "50",
      status: "applied",
      sponsor: null,
    });
  });

  it("updateScholarship PATCHes a status move with its notes", async () => {
    const { updateScholarship } = await import("../scholarships-service");
    mockPatch.mockResolvedValue({ data: { id: "x1" } });

    await updateScholarship("x1", { status: "ended", notes: "Left the school" });

    expect(mockPatch).toHaveBeenCalledWith("/scholarships/x1", {
      status: "ended",
      notes: "Left the school",
    });
  });

  it("has no delete call: the route does not exist", async () => {
    const service = await import("../scholarships-service");

    expect(Object.keys(service).some((name) => /delete|remove/i.test(name))).toBe(false);
  });
});
