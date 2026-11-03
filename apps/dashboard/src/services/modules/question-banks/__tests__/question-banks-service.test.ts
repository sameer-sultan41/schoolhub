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

const BANK = "b1";
const PAGE_META = { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } };

const BANK_INPUT = {
  name: "Algebra",
  subjectId: "s1",
  classId: null,
  description: null,
  status: "active" as const,
};

const QUESTION_INPUT = {
  questionText: "Pick the prime.",
  questionType: "mcq" as const,
  difficulty: "easy" as const,
  defaultMarks: "1",
  topic: null,
  options: ["4", "7"],
  answerKey: "7",
};

describe("question-banks-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("lists /question-banks a page at a time, with its subject and status filters", async () => {
    const { fetchBanksPage } = await import("../question-banks-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchBanksPage({
      page: 2,
      pageSize: 10,
      search: "alg",
      ordering: "name",
      subjectId: "s1",
      status: "active",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/question-banks",
      expect.objectContaining({
        query: {
          page: 2,
          page_size: 10,
          search: "alg",
          ordering: "name",
          subject_id: "s1",
          status: "active",
        },
      }),
    );
  });

  it("reads, creates, updates and deletes a bank through the snake_case body", async () => {
    const service = await import("../question-banks-service");
    mockGet.mockResolvedValue({ data: { id: BANK } });
    mockPost.mockResolvedValue({ data: { id: BANK } });
    mockPatch.mockResolvedValue({ data: { id: BANK } });
    mockDelete.mockResolvedValue({});

    await service.fetchBank(BANK);
    await service.createBank(BANK_INPUT);
    await service.updateBank(BANK, BANK_INPUT);
    await service.deleteBank(BANK);

    const body = {
      name: "Algebra",
      subject_id: "s1",
      class_id: null,
      description: null,
      status: "active",
    };
    expect(mockGet).toHaveBeenCalledWith("/question-banks/b1");
    expect(mockPost).toHaveBeenCalledWith("/question-banks", body);
    expect(mockPatch).toHaveBeenCalledWith("/question-banks/b1", body);
    expect(mockDelete).toHaveBeenCalledWith("/question-banks/b1");
  });

  it("pages a bank's questions by cursor, with the blueprint's filters", async () => {
    const { fetchQuestionsPage } = await import("../question-banks-service");
    mockGet.mockResolvedValue({ data: [], meta: { pagination: { next_cursor: null } } });

    await fetchQuestionsPage({
      bankId: BANK,
      cursor: "c2",
      pageSize: 25,
      ordering: "created_at",
      topic: "Primes",
      difficulty: "hard",
      questionType: "mcq",
      source: "ai_generated",
      isApproved: false,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/question-banks/b1/questions",
      expect.objectContaining({
        query: {
          page_size: 25,
          cursor: "c2",
          ordering: "created_at",
          topic: "Primes",
          difficulty: "hard",
          question_type: "mcq",
          source: "ai_generated",
          is_approved: false,
        },
      }),
    );
  });

  it("writes and removes a question under its bank, and approves one", async () => {
    const service = await import("../question-banks-service");
    mockPost.mockResolvedValue({ data: { id: "q1" } });
    mockPatch.mockResolvedValue({ data: { id: "q1" } });
    mockDelete.mockResolvedValue({});

    await service.createQuestion(BANK, QUESTION_INPUT);
    await service.updateQuestion(BANK, "q1", QUESTION_INPUT);
    await service.deleteQuestion(BANK, "q1");
    await service.approveQuestion(BANK, "q1");

    const body = {
      question_text: "Pick the prime.",
      question_type: "mcq",
      difficulty: "easy",
      default_marks: "1",
      topic: null,
      options: ["4", "7"],
      answer_key: "7",
    };
    expect(mockPost).toHaveBeenCalledWith("/question-banks/b1/questions", body);
    expect(mockPatch).toHaveBeenCalledWith("/question-banks/b1/questions/q1", body);
    expect(mockDelete).toHaveBeenCalledWith("/question-banks/b1/questions/q1");
    expect(mockPost).toHaveBeenCalledWith("/question-banks/b1/questions/q1:approve");
  });

  it("starts a paper's assembly and hands back the job to poll", async () => {
    const { assemblePaper } = await import("../question-banks-service");
    mockPost.mockResolvedValue({ data: { job_id: "j1", status: "queued" } });
    const blueprint = { title: "Term test", sections: [{ difficulty: "easy" as const, count: 2 }] };

    await expect(assemblePaper(BANK, blueprint)).resolves.toEqual({ jobId: "j1" });
    expect(mockPost).toHaveBeenCalledWith("/question-banks/b1:assemble-paper", blueprint);
  });
});
