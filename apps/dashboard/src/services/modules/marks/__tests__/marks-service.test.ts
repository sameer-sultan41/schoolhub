import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("marks-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads one section's grid with its meta typed", async () => {
    const { fetchGrid } = await import("../marks-service");
    mockGet.mockResolvedValue({
      data: [{ student_id: "st1" }],
      meta: {
        exam_subject: {
          max_marks: "100.00",
          pass_marks: "40.00",
          has_practical: true,
          practical_max_marks: "25.00",
        },
        writable: false,
        unwritable_reason: "locked",
        unwritable_message: "Marks for this subject are locked.",
      },
    });

    const grid = await fetchGrid({ examSubjectId: "es1", sectionId: "s1" });

    expect(mockGet).toHaveBeenCalledWith("/marks/grid", {
      query: { exam_subject_id: "es1", section_id: "s1" },
    });
    expect(grid).toEqual({
      entries: [{ student_id: "st1" }],
      meta: {
        examSubject: {
          maxMarks: "100.00",
          passMarks: "40.00",
          hasPractical: true,
          practicalMaxMarks: "25.00",
        },
        writable: false,
        unwritableReason: "locked",
        unwritableMessage: "Marks for this subject are locked.",
      },
    });
  });

  it("sends the grid with section_id and the Idempotency-Key, returning the counts", async () => {
    const { bulkEntry } = await import("../marks-service");
    mockPost.mockResolvedValue({ data: { entered: 1, updated: 1, rows: 2 } });

    const result = await bulkEntry(
      {
        examSubjectId: "es1",
        sectionId: "s1",
        entries: [
          {
            studentId: "st1",
            theoryMarks: "45.5",
            practicalMarks: null,
            isAbsent: false,
            isExempt: false,
            status: "submitted",
            remarks: null,
          },
        ],
      },
      "key-1",
    );

    expect(result).toEqual({ entered: 1, updated: 1, rows: 2 });
    expect(mockPost).toHaveBeenCalledWith(
      "/marks:bulk-entry",
      {
        exam_subject_id: "es1",
        section_id: "s1",
        entries: [
          {
            student_id: "st1",
            theory_marks: "45.5",
            practical_marks: null,
            is_absent: false,
            is_exempt: false,
            status: "submitted",
            remarks: null,
          },
        ],
      },
      { idempotencyKey: "key-1" },
    );
  });

  it("reads an exam's progress rows", async () => {
    const { fetchProgress } = await import("../marks-service");
    mockGet.mockResolvedValue({ data: [{ exam_subject_id: "es1" }] });

    await expect(fetchProgress("e1")).resolves.toEqual([{ exam_subject_id: "es1" }]);
    expect(mockGet).toHaveBeenCalledWith("/exams/e1/marks-progress");
  });

  it("reads one student's marks in one exam, following the cursor", async () => {
    const { fetchStudentMarks } = await import("../marks-service");
    mockGet
      .mockResolvedValueOnce({
        data: [{ id: "m1" }],
        meta: { pagination: { next_cursor: "c2", has_more: true } },
      })
      .mockResolvedValueOnce({
        data: [{ id: "m2" }],
        meta: { pagination: { next_cursor: null, has_more: false } },
      });

    await expect(fetchStudentMarks("e1", "st1")).resolves.toEqual([{ id: "m1" }, { id: "m2" }]);
    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      "/marks",
      expect.objectContaining({
        query: expect.objectContaining({ exam_id: "e1", student_id: "st1" }),
      }),
    );
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      "/marks",
      expect.objectContaining({ query: expect.objectContaining({ cursor: "c2" }) }),
    );
  });

  it("locks and unlocks an exam-subject through its colon-actions", async () => {
    const { lockMarks, unlockMarks } = await import("../marks-service");
    mockPost
      .mockResolvedValueOnce({ data: { locked_rows: 3, already_locked: false } })
      .mockResolvedValueOnce({ data: { unlocked_rows: 3, already_unlocked: false } });

    await expect(lockMarks("es1")).resolves.toEqual({ locked_rows: 3, already_locked: false });
    await expect(unlockMarks("es1")).resolves.toEqual({
      unlocked_rows: 3,
      already_unlocked: false,
    });
    expect(mockPost).toHaveBeenNthCalledWith(1, "/exam-subjects/es1:lock-marks");
    expect(mockPost).toHaveBeenNthCalledWith(2, "/exam-subjects/es1:unlock-marks");
  });

  it("uploads a sheet for one exam-subject as multipart, returning the job", async () => {
    const { importMarks } = await import("../marks-service");
    mockPost.mockResolvedValue({ data: { job_id: "j1", status: "queued" } });
    const file = new File(["admission_number\n"], "marks.csv", { type: "text/csv" });

    await expect(importMarks("es1", file)).resolves.toEqual({ jobId: "j1" });

    const [path, body] = mockPost.mock.calls[0] as [string, FormData];
    expect(path).toBe("/marks-imports");
    expect(body.get("exam_subject_id")).toBe("es1");
    expect(body.get("file")).toBe(file);
  });
});
