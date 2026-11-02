import { marksRecord } from "@/services/modules/marks/__tests__/marks-fixtures";

import {
  applyPatch,
  draftFromMarks,
  initialMarksGrid,
  marksGridReducer,
  type MarksDraft,
} from "../use-marks-grid-form";

const MARKED: MarksDraft = {
  theory: "45.5",
  practical: "10",
  isAbsent: false,
  isExempt: false,
  remarks: "",
};

describe("draftFromMarks", () => {
  it("shows saved marks as typed, and nothing entered as blank", () => {
    expect(draftFromMarks(marksRecord({ remarks: "Late start" }))).toEqual({
      theory: "45.5",
      practical: "",
      isAbsent: false,
      isExempt: false,
      remarks: "Late start",
    });
    expect(draftFromMarks(null)).toEqual({
      theory: "",
      practical: "",
      isAbsent: false,
      isExempt: false,
      remarks: "",
    });
  });
});

describe("applyPatch", () => {
  it("clears both marks and exempt when a student is marked absent", () => {
    expect(applyPatch({ ...MARKED, isExempt: true }, { isAbsent: true })).toEqual({
      ...MARKED,
      theory: "",
      practical: "",
      isAbsent: true,
      isExempt: false,
    });
  });

  it("clears both marks and absent when a student is marked exempt", () => {
    expect(applyPatch({ ...MARKED, isAbsent: true }, { isExempt: true })).toMatchObject({
      theory: "",
      practical: "",
      isAbsent: false,
      isExempt: true,
    });
  });

  it("leaves the marks alone for any other change", () => {
    expect(applyPatch(MARKED, { remarks: "Neat", isAbsent: false })).toEqual({
      ...MARKED,
      remarks: "Neat",
    });
  });
});

describe("marksGridReducer", () => {
  it("takes the action's key on every edit and on a save, dropping edits once saved", () => {
    const start = initialMarksGrid();

    const edited = marksGridReducer(start, {
      type: "edit",
      key: "k1",
      studentId: "s1",
      saved: MARKED,
      patch: { theory: "50" },
    });
    expect(edited.idempotencyKey).toBe("k1");
    expect(edited.edits.get("s1")?.theory).toBe("50");

    const saved = marksGridReducer(edited, { type: "saved", key: "k2" });
    expect(saved).toEqual({ edits: new Map(), idempotencyKey: "k2" });
  });
});
