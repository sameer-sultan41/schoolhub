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

const INPUT = {
  name: "Final",
  academicSessionId: "s1",
  termId: null,
  examType: "final" as const,
  gradingScaleId: null,
  weightagePercent: "100",
  startsOn: null,
  endsOn: null,
  description: null,
};

describe("exams-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("lists /exams a page at a time with the filters the screen sets", async () => {
    const { fetchExamsPage } = await import("../exams-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchExamsPage({
      page: 2,
      pageSize: 10,
      search: "mid",
      ordering: "-starts_on",
      status: "draft",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/exams",
      expect.objectContaining({
        query: { page: 2, page_size: 10, search: "mid", ordering: "-starts_on", status: "draft" },
      }),
    );
  });

  it("sends no session when none is picked", async () => {
    const { fetchExamsPage } = await import("../exams-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchExamsPage({ page: 1, pageSize: 10 });

    const query = (mockGet.mock.calls[0]?.[1] as { query: Record<string, unknown> }).query;
    expect(query).not.toHaveProperty("academic_session_id");
  });

  it("reads, creates, updates and deletes an exam", async () => {
    const service = await import("../exams-service");
    mockGet.mockResolvedValue({ data: { id: "e1" } });
    mockPost.mockResolvedValue({ data: { id: "e1" } });
    mockPatch.mockResolvedValue({ data: { id: "e1" } });
    mockDelete.mockResolvedValue({});

    await service.fetchExam("e1");
    await service.createExam(INPUT);
    await service.updateExam("e1", INPUT);
    await service.deleteExam("e1");

    const body = {
      name: "Final",
      academic_session_id: "s1",
      term_id: null,
      exam_type: "final",
      weightage_percent: "100",
      starts_on: null,
      ends_on: null,
      description: null,
    };
    expect(mockGet).toHaveBeenCalledWith("/exams/e1");
    expect(mockPost).toHaveBeenCalledWith("/exams", body);
    expect(mockPatch).toHaveBeenCalledWith("/exams/e1", body);
    expect(mockDelete).toHaveBeenCalledWith("/exams/e1");
  });
});
