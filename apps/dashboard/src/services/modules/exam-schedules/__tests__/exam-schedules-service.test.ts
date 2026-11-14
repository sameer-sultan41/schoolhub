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

const HARD = {
  type: "room_double_booked",
  severity: "hard",
  schedule_ids: ["a", "b"],
  message: "Room 101 is booked twice.",
};

const INPUT = {
  examSubjectId: "x1",
  sectionId: "s1",
  examDate: "2026-10-05",
  startTime: "09:00",
  endTime: "11:00",
  roomId: null,
  invigilatorStaffId: null,
};

describe("exam-schedules-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("collects the whole of one exam's sittings across the cursor pages", async () => {
    const { fetchSittings } = await import("../exam-schedules-service");
    mockGet
      .mockResolvedValueOnce(cursorPage(["a", "b"], "c2"))
      .mockResolvedValueOnce(cursorPage(["c"], null));

    const rows = await fetchSittings("e1");

    expect(rows.map((row) => (row as { id: string }).id)).toEqual(["a", "b", "c"]);
    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      "/exam-schedules",
      expect.objectContaining({ query: expect.objectContaining({ exam_id: "e1" }) }),
    );
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      "/exam-schedules",
      expect.objectContaining({
        query: expect.objectContaining({ exam_id: "e1", cursor: "c2" }),
      }),
    );
  });

  it("creates and updates through the snake_case body, returning the sitting with meta.conflicts", async () => {
    const service = await import("../exam-schedules-service");
    mockPost.mockResolvedValue({ data: { id: "x1" }, meta: { conflicts: [HARD] } });
    mockPatch.mockResolvedValue({ data: { id: "x1" }, meta: {} });

    const created = await service.createSitting(INPUT);
    const updated = await service.updateSitting("x1", { endTime: "12:00" });

    expect(mockPost).toHaveBeenCalledWith("/exam-schedules", {
      exam_subject_id: "x1",
      section_id: "s1",
      exam_date: "2026-10-05",
      start_time: "09:00",
      end_time: "11:00",
      room_id: null,
      invigilator_staff_id: null,
    });
    expect(created).toEqual({ sitting: { id: "x1" }, conflicts: [HARD] });
    expect(mockPatch).toHaveBeenCalledWith("/exam-schedules/x1", { end_time: "12:00" });
    expect(updated).toEqual({ sitting: { id: "x1" }, conflicts: [] });
  });

  it("cancels a sitting by patching its status, not deleting it", async () => {
    const { cancelSitting } = await import("../exam-schedules-service");
    mockPatch.mockResolvedValue({ data: { id: "x1", status: "cancelled" }, meta: {} });

    const result = await cancelSitting("x1");

    expect(mockPatch).toHaveBeenCalledWith("/exam-schedules/x1", { status: "cancelled" });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(result.sitting).toEqual({ id: "x1", status: "cancelled" });
  });

  it("deletes a sitting", async () => {
    const { deleteSitting } = await import("../exam-schedules-service");
    mockDelete.mockResolvedValue({});

    await deleteSitting("x1");

    expect(mockDelete).toHaveBeenCalledWith("/exam-schedules/x1");
  });

  it("reads the exam's clash list from its own endpoint", async () => {
    const { fetchConflicts } = await import("../exam-schedules-service");
    mockGet.mockResolvedValue({ data: [HARD] });

    await expect(fetchConflicts("e1")).resolves.toEqual([HARD]);
    expect(mockGet).toHaveBeenCalledWith("/exams/e1/schedule-conflicts");
  });

  it("publishes through the colon-action", async () => {
    const { publishSchedule } = await import("../exam-schedules-service");
    mockPost.mockResolvedValue({ data: { status: "scheduled", conflicts: [] } });

    await expect(publishSchedule("e1")).resolves.toEqual({ status: "scheduled", conflicts: [] });
    expect(mockPost).toHaveBeenCalledWith("/exams/e1:publish-schedule");
  });
});
