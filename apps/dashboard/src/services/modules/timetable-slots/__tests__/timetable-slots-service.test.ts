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

describe("timetable-slots-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("reads one section's current cells in period order, following every cursor", async () => {
    const { fetchSectionSlots } = await import("../timetable-slots-service");
    mockGet
      .mockResolvedValueOnce({
        data: [{ id: "s1" }],
        meta: { pagination: { next_cursor: "c2", previous_cursor: null, page_size: 1 } },
      })
      .mockResolvedValueOnce({
        data: [{ id: "s2" }],
        meta: { pagination: { next_cursor: null, previous_cursor: "c1", page_size: 1 } },
      });

    const slots = await fetchSectionSlots("sess-1", "sec-1");

    expect(slots).toEqual([{ id: "s1" }, { id: "s2" }]);
    expect(mockGet).toHaveBeenCalledWith(
      "/timetable-slots",
      expect.objectContaining({
        query: expect.objectContaining({
          academic_session_id: "sess-1",
          section_id: "sec-1",
          current: true,
          ordering: "period_sequence,day_of_week,created_at",
          page_size: 100,
        }),
      }),
    );
  });

  it("returns each write's slot with the section's conflicts from meta", async () => {
    const { createSlot, deleteSlot, updateSlot } = await import("../timetable-slots-service");
    const found = [
      { type: "room_double_booked", severity: "hard", slot_ids: ["s1"], message: "m" },
    ];
    mockPost.mockResolvedValue({ data: { id: "s1" }, meta: { conflicts: found } });
    mockPatch.mockResolvedValue({ data: { id: "s1" }, meta: { conflicts: [] } });
    mockDelete.mockResolvedValue({ data: null, meta: { conflicts: found } });

    const created = await createSlot({
      academicSessionId: "sess-1",
      sectionId: "sec-1",
      dayOfWeek: 0,
      periodId: "p1",
      subjectId: null,
      staffId: null,
      roomId: null,
      notes: null,
    });
    const moved = await updateSlot("s1", { dayOfWeek: 2, periodId: "p2" });
    const removed = await deleteSlot("s1");

    expect(mockPost).toHaveBeenCalledWith("/timetable-slots", {
      academic_session_id: "sess-1",
      section_id: "sec-1",
      day_of_week: 0,
      period_id: "p1",
      subject_id: null,
      staff_id: null,
      room_id: null,
      notes: null,
    });
    expect(mockPatch).toHaveBeenCalledWith("/timetable-slots/s1", {
      day_of_week: 2,
      period_id: "p2",
    });
    expect(created).toEqual({ slot: { id: "s1" }, conflicts: found });
    expect(moved.conflicts).toEqual([]);
    expect(removed).toEqual({ slot: null, conflicts: found });
  });

  it("validates and publishes on the section's colon-actions, naming the session", async () => {
    const { publishSection, validateSection } = await import("../timetable-slots-service");
    mockPost.mockResolvedValue({ data: { published: 3 } });

    await validateSection("sec-1", "sess-1");
    await publishSection("sec-1", "sess-1");

    expect(mockPost).toHaveBeenNthCalledWith(1, "/timetables/sec-1:validate", {
      academic_session_id: "sess-1",
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/timetables/sec-1:publish", {
      academic_session_id: "sess-1",
    });
  });
  it("reads the caller's own week, with a date only when one is chosen, as the data array", async () => {
    const { fetchMyTimetable } = await import("../timetable-slots-service");
    mockGet.mockResolvedValue({ data: [{ id: "s1" }], meta: { audience: "teacher" } });

    expect(await fetchMyTimetable()).toEqual([{ id: "s1" }]);
    await fetchMyTimetable("2026-10-19");

    expect(mockGet).toHaveBeenNthCalledWith(1, "/timetables/my", { query: {} });
    expect(mockGet).toHaveBeenNthCalledWith(2, "/timetables/my", {
      query: { date: "2026-10-19" },
    });
  });

  it("reads one teacher's live published classes on a weekday", async () => {
    const { fetchTeacherClassesOn } = await import("../timetable-slots-service");
    mockGet.mockResolvedValue({ data: [{ id: "s1" }], meta: {} });

    expect(await fetchTeacherClassesOn("sess-1", "staff-1", 2)).toEqual([{ id: "s1" }]);
    expect(mockGet).toHaveBeenCalledWith(
      "/timetable-slots",
      expect.objectContaining({
        query: expect.objectContaining({
          academic_session_id: "sess-1",
          teacher_id: "staff-1",
          weekday: 2,
          status: "published",
          current: true,
        }),
      }),
    );
  });
});
