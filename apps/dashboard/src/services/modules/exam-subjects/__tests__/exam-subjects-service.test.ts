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

const cursorPage = (ids: string[], next: string | null) => ({
  data: ids.map((id) => ({ id })),
  meta: { pagination: { next_cursor: next, has_more: next !== null } },
});

const INPUT = {
  examId: "e1",
  classId: "c1",
  subjectId: "s1",
  maxMarks: "100",
  passMarks: "40",
  hasPractical: false,
  practicalMaxMarks: null,
  practicalPassMarks: null,
  subjectWeightagePercent: "100",
  marksEntryOpensAt: null,
  marksEntryClosesAt: null,
};

describe("exam-subjects-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("collects the whole of one exam's subjects across the cursor pages", async () => {
    const { fetchExamSubjects } = await import("../exam-subjects-service");
    mockGet
      .mockResolvedValueOnce(cursorPage(["a", "b"], "c2"))
      .mockResolvedValueOnce(cursorPage(["c"], null));

    const rows = await fetchExamSubjects("e1");

    expect(rows.map((row) => (row as { id: string }).id)).toEqual(["a", "b", "c"]);
    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      "/exam-subjects",
      expect.objectContaining({ query: expect.objectContaining({ exam_id: "e1" }) }),
    );
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      "/exam-subjects",
      expect.objectContaining({
        query: expect.objectContaining({ exam_id: "e1", cursor: "c2" }),
      }),
    );
  });

  it("creates, updates and deletes through the snake_case body", async () => {
    const service = await import("../exam-subjects-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });
    mockPatch.mockResolvedValue({ data: { id: "x1" } });
    mockDelete.mockResolvedValue({});

    await service.createExamSubject(INPUT);
    await service.updateExamSubject("x1", INPUT);
    await service.deleteExamSubject("x1");

    const body = {
      exam_id: "e1",
      class_id: "c1",
      subject_id: "s1",
      max_marks: "100",
      pass_marks: "40",
      has_practical: false,
      practical_max_marks: null,
      practical_pass_marks: null,
      subject_weightage_percent: "100",
      marks_entry_opens_at: null,
      marks_entry_closes_at: null,
    };
    expect(mockPost).toHaveBeenCalledWith("/exam-subjects", body);
    expect(mockPatch).toHaveBeenCalledWith("/exam-subjects/x1", body);
    expect(mockDelete).toHaveBeenCalledWith("/exam-subjects/x1");
  });
});
