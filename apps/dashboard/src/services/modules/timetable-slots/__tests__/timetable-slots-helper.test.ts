import { ApiError } from "@schoolhub/api-client";

import {
  buildCellIndex,
  buildSlotInput,
  cellKey,
  conflictsBySlot,
  conflictsFromError,
  conflictsFromMeta,
  orderTeachersByAllocation,
  periodRunsOn,
  slotToFormValues,
  visibleWeekdays,
} from "../timetable-slots-helper";
import {
  conflict,
  OTHER_TEACHER_ID,
  PERIOD_1_ID,
  SECTION_ID,
  SUBJECT_ID,
  TEACHER_ID,
  slotRecord,
} from "./timetable-slots-fixtures";

describe("buildCellIndex", () => {
  it("lets a draft win the cell over the published row it replaces, either order", () => {
    const published = slotRecord({ status: "published" });
    const draft = slotRecord();

    for (const rows of [
      [published, draft],
      [draft, published],
    ]) {
      const cell = buildCellIndex(rows).get(cellKey(0, PERIOD_1_ID));
      expect(cell?.slot.id).toBe(draft.id);
      expect(cell?.replacesPublished).toBe(true);
    }
  });

  it("shows a lone published cell, and skips superseded rows", () => {
    const published = slotRecord({ status: "published" });
    const superseded = slotRecord({
      status: "published",
      effective_to: "2026-09-01",
      day_of_week: 1,
    });

    const index = buildCellIndex([published, superseded]);

    expect(index.get(cellKey(0, PERIOD_1_ID))).toEqual({
      slot: published,
      replacesPublished: false,
    });
    expect(index.has(cellKey(1, PERIOD_1_ID))).toBe(false);
  });
});

describe("visibleWeekdays and periodRunsOn", () => {
  it("shows Monday to Friday, plus a weekend day only once it holds a cell", () => {
    expect(visibleWeekdays([])).toEqual([0, 1, 2, 3, 4]);
    expect(visibleWeekdays([slotRecord({ day_of_week: 5 })])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reads null or empty weekdays as every working day", () => {
    expect(periodRunsOn(null, 3)).toBe(true);
    expect(periodRunsOn([], 3)).toBe(true);
    expect(periodRunsOn([0, 2], 3)).toBe(false);
  });
});

describe("conflict reading", () => {
  it("keeps the server's order, and counts an unknown severity as hard", () => {
    const soft = conflict({ severity: "soft", type: "room_over_capacity" });
    const odd = {
      ...conflict({ type: "new_rule" }),
      severity: "critical",
    } as unknown as ReturnType<typeof conflict>;

    const read = conflictsFromMeta({ conflicts: [soft, odd] });

    expect(read.map((c) => c.type)).toEqual(["room_over_capacity", "new_rule"]);
    expect(read[1]?.severity).toBe("hard");
  });

  it("reads nothing from missing or malformed meta", () => {
    expect(conflictsFromMeta(undefined)).toEqual([]);
    expect(conflictsFromMeta({ conflicts: "nope" })).toEqual([]);
    expect(conflictsFromMeta({ conflicts: [{ type: "x" }] })).toEqual([]);
  });

  it("reads a refused publish's findings from the error's meta, not its details", () => {
    const hard = conflict({ slot_ids: ["s1", "s2"] });
    const error = new ApiError({
      code: "domain_rule_violation",
      message: "This timetable has unresolved hard conflicts and cannot be published.",
      status: 422,
      url: `/timetables/${SECTION_ID}:publish`,
      details: [{ field: "non_field", issue: "unresolved" }],
      meta: { conflicts: [hard] },
    });

    expect(conflictsFromError(error)).toEqual([hard]);
    expect(conflictsFromError(new Error("network"))).toEqual([]);
  });

  it("files a finding under every slot it names", () => {
    const clash = conflict({ slot_ids: ["s1", "s2"] });

    const index = conflictsBySlot([clash]);

    expect(index.get("s1")).toEqual([clash]);
    expect(index.get("s2")).toEqual([clash]);
  });
});

describe("the cell form", () => {
  it("puts allocated teachers first, keeping each group's order", () => {
    const teachers = [
      { id: OTHER_TEACHER_ID, name: "Bilal Khan" },
      { id: TEACHER_ID, name: "Amna Raza" },
    ];
    const allocations = [{ staff_id: TEACHER_ID, subject_id: SUBJECT_ID }];

    expect(orderTeachersByAllocation(teachers, allocations, SUBJECT_ID)).toEqual([
      { id: TEACHER_ID, name: "Amna Raza", allocated: true },
      { id: OTHER_TEACHER_ID, name: "Bilal Khan", allocated: false },
    ]);
    // Another subject: nobody is allocated, so the order is untouched.
    expect(orderTeachersByAllocation(teachers, allocations, "other").map((c) => c.id)).toEqual([
      OTHER_TEACHER_ID,
      TEACHER_ID,
    ]);
  });

  it("sends an emptied pick or note as null", () => {
    const values = { ...slotToFormValues(slotRecord()), room_id: "", notes: "  " };

    expect(
      buildSlotInput(values, {
        academicSessionId: "s",
        sectionId: SECTION_ID,
        dayOfWeek: 2,
        periodId: PERIOD_1_ID,
      }),
    ).toEqual({
      academicSessionId: "s",
      sectionId: SECTION_ID,
      dayOfWeek: 2,
      periodId: PERIOD_1_ID,
      subjectId: SUBJECT_ID,
      staffId: TEACHER_ID,
      roomId: null,
      notes: null,
    });
  });
});
