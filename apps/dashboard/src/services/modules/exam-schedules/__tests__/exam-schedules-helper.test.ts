import { ApiError } from "@schoolhub/api-client";

import {
  buildSittingInput,
  conflictsBySitting,
  conflictsFromError,
  conflictsFromMeta,
  defaultSittingFormValues,
  formatSittingDate,
  groupByDate,
  hardConflictCount,
  hardFirst,
  isSchedulePublishable,
  isSittingOpen,
  recordToSittingFormValues,
  toShortTime,
  toSittingBody,
  worstSeverity,
} from "../exam-schedules-helper";
import { createSittingFormSchema } from "../exam-schedules.schema";
import {
  conflictRecord,
  OTHER_SECTION_ID,
  OTHER_SITTING_ID,
  SECTION_ID,
  SITTING_ID,
  sittingRecord,
} from "./exam-schedules-fixtures";

describe("toSittingBody", () => {
  it("maps each key to the API's own, keeping a null that clears a room or an invigilator", () => {
    expect(
      toSittingBody({
        examSubjectId: "x1",
        sectionId: "s1",
        examDate: "2026-10-05",
        startTime: "09:00",
        endTime: "11:00",
        roomId: null,
        invigilatorStaffId: null,
      }),
    ).toEqual({
      exam_subject_id: "x1",
      section_id: "s1",
      exam_date: "2026-10-05",
      start_time: "09:00",
      end_time: "11:00",
      room_id: null,
      invigilator_staff_id: null,
    });
  });

  it("leaves out what a patch doesn't name", () => {
    expect(toSittingBody({ endTime: "12:00" })).toEqual({ end_time: "12:00" });
  });
});

describe("conflict readers", () => {
  it("reads a write's meta.conflicts in the server's order", () => {
    const hard = conflictRecord();
    const soft = conflictRecord({ type: "room_over_capacity", severity: "soft" });

    expect(conflictsFromMeta({ conflicts: [hard, soft] })).toEqual([hard, soft]);
  });

  it("reads a missing or malformed list as no findings, never a crash", () => {
    expect(conflictsFromMeta(undefined)).toEqual([]);
    expect(conflictsFromMeta({})).toEqual([]);
    expect(conflictsFromMeta({ conflicts: "nope" })).toEqual([]);
    expect(conflictsFromMeta({ conflicts: [null, { type: "x" }, conflictRecord()] })).toEqual([
      conflictRecord(),
    ]);
  });

  it("counts a finding with a severity the app doesn't know as hard", () => {
    const findings = conflictsFromMeta({
      conflicts: [{ ...conflictRecord(), severity: "catastrophic" }],
    });

    expect(findings[0]?.severity).toBe("hard");
  });

  it("reads a refused publish's findings from the error's meta, not its details", () => {
    const hard = conflictRecord({ schedule_ids: [SITTING_ID, OTHER_SITTING_ID] });
    const error = new ApiError({
      code: "domain_rule_violation",
      message: "1 clash(es) must be resolved before this schedule can be published.",
      status: 422,
      url: "/exams/e1:publish-schedule",
      details: [],
      meta: { conflicts: [hard] },
    });

    expect(conflictsFromError(error)).toEqual([hard]);
    expect(conflictsFromError(new Error("network"))).toEqual([]);
  });
});

describe("conflict helpers", () => {
  const soft = conflictRecord({
    type: "room_over_capacity",
    severity: "soft",
    schedule_ids: [OTHER_SITTING_ID],
  });
  const hard = conflictRecord({ schedule_ids: [SITTING_ID, OTHER_SITTING_ID] });

  it("counts the hard findings only", () => {
    expect(hardConflictCount([soft, hard, hard])).toBe(2);
    expect(hardConflictCount([soft])).toBe(0);
  });

  it("puts hard findings first, each severity keeping its order", () => {
    const hard2 = conflictRecord({ type: "invigilator_double_booked" });

    expect(hardFirst([soft, hard, hard2])).toEqual([hard, hard2, soft]);
  });

  it("files a finding under every sitting it names", () => {
    const index = conflictsBySitting([hard, soft]);

    expect(index.get(SITTING_ID)).toEqual([hard]);
    expect(index.get(OTHER_SITTING_ID)).toEqual([hard, soft]);
  });

  it("takes a sitting's worst severity, or none when no finding names it", () => {
    expect(worstSeverity([soft, hard])).toBe("hard");
    expect(worstSeverity([soft])).toBe("soft");
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity(undefined)).toBeNull();
  });
});

describe("groupByDate", () => {
  it("groups by date and orders each day by start time, then class and section", () => {
    const days = groupByDate([
      sittingRecord({ id: "c", exam_date: "2026-10-06", start_time: "08:00:00" }),
      sittingRecord({ id: "b", start_time: "13:00:00" }),
      sittingRecord({ id: "a", start_time: "09:00:00", section_name: "B" }),
      sittingRecord({ id: "z", start_time: "09:00:00", section_name: "A" }),
    ]);

    expect(days.map((day) => day.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(days[0]?.sittings.map((sitting) => sitting.id)).toEqual(["z", "a", "b"]);
    expect(days[1]?.sittings.map((sitting) => sitting.id)).toEqual(["c"]);
  });

  it("is empty with no sittings", () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe("formatSittingDate", () => {
  it("reads the date as that calendar day, in the viewer's language", () => {
    expect(formatSittingDate("2026-10-05", "en")).toBe("Monday, October 5, 2026");
  });

  it("returns a value that is not a date as it is", () => {
    expect(formatSittingDate("soon", "en")).toBe("soon");
  });
});

describe("sitting text and state", () => {
  it("trims a time to HH:MM", () => {
    expect(toShortTime("09:00:00")).toBe("09:00");
  });

  it("calls a sitting open only while it is scheduled", () => {
    expect(isSittingOpen(sittingRecord())).toBe(true);
    expect(isSittingOpen(sittingRecord({ status: "completed" }))).toBe(false);
    expect(isSittingOpen(sittingRecord({ status: "cancelled" }))).toBe(false);
  });

  it("offers publishing on a draft or scheduled exam only", () => {
    expect(isSchedulePublishable("draft")).toBe(true);
    expect(isSchedulePublishable("scheduled")).toBe(true);
    expect(isSchedulePublishable("ongoing")).toBe(false);
    expect(isSchedulePublishable("archived")).toBe(false);
  });
});

describe("form mapping", () => {
  it("starts empty", () => {
    expect(defaultSittingFormValues()).toEqual({
      exam_subject_id: "",
      section_id: "",
      exam_date: "",
      start_time: "",
      end_time: "",
      room_id: "",
      invigilator_staff_id: "",
    });
  });

  it("fills the form from a record, with times as HH:MM and a missing room as blank", () => {
    const values = recordToSittingFormValues(
      sittingRecord({ room_id: null, invigilator_staff_id: null }),
    );

    expect(values).toMatchObject({
      section_id: SECTION_ID,
      start_time: "09:00",
      end_time: "11:00",
      room_id: "",
      invigilator_staff_id: "",
    });
  });

  it("sends a blank room or invigilator as null, which clears it", () => {
    const input = buildSittingInput({
      ...defaultSittingFormValues(),
      exam_subject_id: "x1",
      section_id: OTHER_SECTION_ID,
      exam_date: "2026-10-05",
      start_time: "09:00",
      end_time: "11:00",
    });

    expect(input).toEqual({
      examSubjectId: "x1",
      sectionId: OTHER_SECTION_ID,
      examDate: "2026-10-05",
      startTime: "09:00",
      endTime: "11:00",
      roomId: null,
      invigilatorStaffId: null,
    });
  });
});

describe("the sitting form schema", () => {
  const schema = createSittingFormSchema({ required: "Required", endBeforeStart: "End later" });
  const valid = {
    exam_subject_id: "x1",
    section_id: "s1",
    exam_date: "2026-10-05",
    start_time: "09:00",
    end_time: "11:00",
    room_id: "",
    invigilator_staff_id: "",
  };

  it("accepts a sitting with no room and no invigilator", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("asks for the paper, section, date and times", () => {
    const result = schema.safeParse({ ...valid, exam_subject_id: "", exam_date: "" });

    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      "exam_subject_id",
      "exam_date",
    ]);
  });

  it("refuses an end that is not after the start, under End", () => {
    const result = schema.safeParse({ ...valid, end_time: "09:00" });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["end_time"], message: "End later" }),
    ]);
  });
});
