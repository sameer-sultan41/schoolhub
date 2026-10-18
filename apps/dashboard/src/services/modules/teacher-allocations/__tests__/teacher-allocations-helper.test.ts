import type { ApiMeta } from "@schoolhub/types";
import {
  allocationErrorFields,
  allocationStateToCurrent,
  buildAllocateInput,
  buildAllocationUpdate,
  canEndAllocation,
  curriculumToSubjectOptions,
  defaultAllocationFormValues,
  hasAllocationChanges,
  hasAllocationStarted,
  isAllocationEnded,
  isPrimaryAllocation,
  recordToAllocationFormValues,
  sortOverNormFirst,
  toAllocationCreateBody,
  toAllocationQueryParams,
  toAllocationSaveResult,
  toAllocationUpdateBody,
} from "../teacher-allocations-helper";
import type { TeacherAllocationRecord } from "../teacher-allocations-type";
import { curriculumRecord } from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import { CLASS_ID, SESSION_ID, SUBJECT_ID } from "@/test-fixtures/academics";
import {
  allocationRecord,
  loadRow,
  OTHER_STAFF_ID,
  OTHER_SUBJECT_ID,
  SECTION_ID,
  STAFF_ID,
} from "./teacher-allocations-fixtures";

const ALLOCATION = { id: "a1" } as TeacherAllocationRecord;
const WARNING = { code: "teacher_over_norm", staff_id: "staff-1", weekly_periods: 34, norm: 30 };

describe("toAllocationCreateBody", () => {
  it("maps every input field to its snake_case key and has no effective_to", () => {
    const body = toAllocationCreateBody({
      academicSessionId: "sess-1",
      sectionId: "section-1",
      subjectId: "subject-1",
      staffId: "staff-1",
      isPrimary: false,
      weeklyPeriods: null,
      effectiveFrom: null,
    });

    expect(body).toEqual({
      academic_session_id: "sess-1",
      section_id: "section-1",
      subject_id: "subject-1",
      staff_id: "staff-1",
      is_primary: false,
      weekly_periods: null,
      effective_from: null,
    });
    expect(body).not.toHaveProperty("effective_to");
  });
});

describe("toAllocationUpdateBody", () => {
  it("keeps null and false (real values) but drops undefined", () => {
    const body = toAllocationUpdateBody({
      isPrimary: false,
      weeklyPeriods: null,
      effectiveFrom: undefined,
    });

    expect(body).toEqual({ is_primary: false, weekly_periods: null });
    expect(body).not.toHaveProperty("effective_from");
    expect(body).not.toHaveProperty("effective_to");
  });

  it("maps effectiveTo, including null to reinstate", () => {
    expect(toAllocationUpdateBody({ effectiveTo: "2026-10-01" })).toEqual({
      effective_to: "2026-10-01",
    });
    expect(toAllocationUpdateBody({ effectiveTo: null })).toEqual({ effective_to: null });
  });
});

describe("toAllocationQueryParams", () => {
  it("adds page and page_size only when given, then the filters that are set", () => {
    expect(toAllocationQueryParams({ academicSessionId: "sess-1" })).toEqual({
      academic_session_id: "sess-1",
    });
    expect(toAllocationQueryParams({ page: 3, pageSize: 50, academicSessionId: "s1" })).toEqual({
      page: 3,
      page_size: 50,
      academic_session_id: "s1",
    });
  });

  it("drops empty strings and keeps current=false", () => {
    const params = toAllocationQueryParams({
      academicSessionId: "sess-1",
      search: "",
      staffId: "",
      current: false,
    });

    expect(params).toEqual({ academic_session_id: "sess-1", current: false });
  });
});

describe("toAllocationSaveResult", () => {
  it("passes meta.warnings through beside the allocation", () => {
    expect(toAllocationSaveResult(ALLOCATION, { warnings: [WARNING] })).toEqual({
      allocation: ALLOCATION,
      warnings: [WARNING],
    });
  });

  it.each<[string, ApiMeta | undefined]>([
    ["no meta", undefined],
    ["a meta without warnings", { pagination: undefined }],
    ["an empty list", { warnings: [] }],
    ["something that is not a list", { warnings: "teacher_over_norm" }],
  ])("has no warnings for %s", (_label, meta) => {
    expect(toAllocationSaveResult(ALLOCATION, meta)).toEqual({
      allocation: ALLOCATION,
      warnings: [],
    });
  });
});

describe("allocationStateToCurrent", () => {
  it.each([
    ["current", true],
    ["ended", false],
    ["all", undefined],
    ["anything else", undefined],
  ])("maps the %s state to the API's current flag", (state, expected) => {
    expect(allocationStateToCurrent(state)).toBe(expected);
  });
});

describe("an allocation's state", () => {
  const TODAY = "2026-10-14";

  it("is ended once it has an end date, and current without one", () => {
    expect(isAllocationEnded(allocationRecord({ effective_to: "2026-09-30" }))).toBe(true);
    expect(isAllocationEnded(allocationRecord({ effective_to: null }))).toBe(false);
    expect(isAllocationEnded(allocationRecord({ effective_to: undefined }))).toBe(false);
  });

  it.each([
    ["no start date", null, true],
    ["a start in the past", "2026-09-01", true],
    ["a start today", TODAY, true],
    ["a start tomorrow", "2026-10-15", false],
  ])("has started with %s: %s", (_label, effectiveFrom, expected) => {
    expect(hasAllocationStarted(allocationRecord({ effective_from: effectiveFrom }), TODAY)).toBe(
      expected,
    );
  });

  it("can be ended only while current and already started", () => {
    expect(canEndAllocation(allocationRecord(), TODAY)).toBe(true);
    expect(canEndAllocation(allocationRecord({ effective_from: TODAY }), TODAY)).toBe(true);
    expect(canEndAllocation(allocationRecord({ effective_from: "2026-10-15" }), TODAY)).toBe(false);
    expect(canEndAllocation(allocationRecord({ effective_to: "2026-10-01" }), TODAY)).toBe(false);
  });

  it("is primary unless the record says otherwise, defaulting to the model's primary", () => {
    expect(isPrimaryAllocation(allocationRecord({ is_primary: false }))).toBe(false);
    expect(isPrimaryAllocation(allocationRecord({ is_primary: true }))).toBe(true);
    expect(isPrimaryAllocation(allocationRecord({ is_primary: undefined }))).toBe(true);
  });
});

describe("allocationErrorFields", () => {
  it("offers every field the allocate form shows, and only the editable ones for an edit", () => {
    expect(allocationErrorFields("create")).toEqual([
      "section_id",
      "subject_id",
      "staff_id",
      "is_primary",
      "weekly_periods",
      "effective_from",
    ]);
    expect(allocationErrorFields("edit")).toEqual([
      "is_primary",
      "weekly_periods",
      "effective_from",
    ]);
  });
});

describe("allocation form values", () => {
  it("starts a new allocation as primary, with no override or start date", () => {
    expect(defaultAllocationFormValues()).toEqual({
      class_id: "",
      section_id: "",
      subject_id: "",
      staff_id: "",
      is_primary: true,
      weekly_periods: "",
      effective_from: "",
    });
  });

  it("reads an existing allocation's editable values, a missing one as blank", () => {
    expect(recordToAllocationFormValues(allocationRecord())).toEqual({
      is_primary: true,
      weekly_periods: "",
      effective_from: "",
    });
    expect(
      recordToAllocationFormValues(
        allocationRecord({ is_primary: false, weekly_periods: 7, effective_from: "2026-09-01" }),
      ),
    ).toEqual({ is_primary: false, weekly_periods: "7", effective_from: "2026-09-01" });
  });

  it("builds the allocate input: no class, a blank override and start date as null", () => {
    const input = buildAllocateInput(
      {
        class_id: CLASS_ID,
        section_id: SECTION_ID,
        subject_id: SUBJECT_ID,
        staff_id: STAFF_ID,
        is_primary: true,
        weekly_periods: "",
        effective_from: "",
      },
      SESSION_ID,
    );

    expect(input).toEqual({
      academicSessionId: SESSION_ID,
      sectionId: SECTION_ID,
      subjectId: SUBJECT_ID,
      staffId: STAFF_ID,
      isPrimary: true,
      weeklyPeriods: null,
      effectiveFrom: null,
    });
    expect(input).not.toHaveProperty("classId");
    expect(input).not.toHaveProperty("effectiveTo");
  });

  it("builds the allocate input with the override as a number and the start date as typed", () => {
    const input = buildAllocateInput(
      {
        class_id: CLASS_ID,
        section_id: SECTION_ID,
        subject_id: SUBJECT_ID,
        staff_id: STAFF_ID,
        is_primary: false,
        weekly_periods: "6",
        effective_from: "2026-09-01",
      },
      SESSION_ID,
    );

    expect(input).toMatchObject({
      isPrimary: false,
      weeklyPeriods: 6,
      effectiveFrom: "2026-09-01",
    });
  });
});

describe("buildAllocationUpdate", () => {
  const INITIAL = { is_primary: true, weekly_periods: "5", effective_from: "2026-09-01" };

  it("is empty when nothing changed", () => {
    const update = buildAllocationUpdate(INITIAL, INITIAL);

    expect(update).toEqual({});
    expect(hasAllocationChanges(update)).toBe(false);
  });

  it("sends only the fields that changed", () => {
    expect(buildAllocationUpdate({ ...INITIAL, weekly_periods: "7" }, INITIAL)).toEqual({
      weeklyPeriods: 7,
    });
    expect(buildAllocationUpdate({ ...INITIAL, is_primary: false }, INITIAL)).toEqual({
      isPrimary: false,
    });
    expect(buildAllocationUpdate({ ...INITIAL, effective_from: "2026-09-15" }, INITIAL)).toEqual({
      effectiveFrom: "2026-09-15",
    });
  });

  it("sends all three when all changed, and never effectiveTo", () => {
    const update = buildAllocationUpdate(
      { is_primary: false, weekly_periods: "9", effective_from: "2026-10-01" },
      INITIAL,
    );

    expect(update).toEqual({ isPrimary: false, weeklyPeriods: 9, effectiveFrom: "2026-10-01" });
    expect(update).not.toHaveProperty("effectiveTo");
    expect(hasAllocationChanges(update)).toBe(true);
  });

  it("sends null for a cleared override or start date, to clear it", () => {
    const update = buildAllocationUpdate(
      { ...INITIAL, weekly_periods: "", effective_from: "" },
      INITIAL,
    );

    expect(update).toEqual({ weeklyPeriods: null, effectiveFrom: null });
    expect(hasAllocationChanges(update)).toBe(true);
  });

  it("sends a typed override for a row that had none", () => {
    const initial = { ...INITIAL, weekly_periods: "" };

    expect(buildAllocationUpdate({ ...initial, weekly_periods: "4" }, initial)).toEqual({
      weeklyPeriods: 4,
    });
  });

  it("compares the override as a number, so the same number retyped is not a change", () => {
    const retyped = buildAllocationUpdate({ ...INITIAL, weekly_periods: "05" }, INITIAL);

    expect(retyped).not.toHaveProperty("weeklyPeriods");
    expect(hasAllocationChanges(retyped)).toBe(false);
    expect(buildAllocationUpdate({ ...INITIAL, weekly_periods: "6" }, INITIAL)).toEqual({
      weeklyPeriods: 6,
    });
  });

  it("sends nothing for a blank override on a row that had none, and null to clear one", () => {
    const none = { ...INITIAL, weekly_periods: "" };

    expect(buildAllocationUpdate(none, none)).toEqual({});
    expect(buildAllocationUpdate({ ...none, weekly_periods: "  " }, none)).toEqual({});
    expect(buildAllocationUpdate(none, INITIAL)).toEqual({ weeklyPeriods: null });
  });
});

describe("curriculumToSubjectOptions", () => {
  it("lists each subject once, in the curriculum's order", () => {
    const options = curriculumToSubjectOptions([
      curriculumRecord(),
      curriculumRecord({ id: "c2", campus_id: "campus-2", campus_name: "East Campus" }),
      curriculumRecord({ id: "c3", subject_id: OTHER_SUBJECT_ID, subject_name: "English" }),
    ]);

    expect(options).toEqual([
      { id: SUBJECT_ID, name: "Mathematics" },
      { id: OTHER_SUBJECT_ID, name: "English" },
    ]);
  });

  it("is empty for a class with no curriculum", () => {
    expect(curriculumToSubjectOptions([])).toEqual([]);
  });
});

describe("sortOverNormFirst", () => {
  it("puts over-norm teachers first and keeps the server's order within each group", () => {
    const within = loadRow({ staff_id: "a", name: "Ayesha" });
    const over = loadRow({ staff_id: "b", name: "Bilal", weekly_periods: 36, over_norm: true });
    const alsoWithin = loadRow({ staff_id: "c", name: "Zainab" });
    const alsoOver = loadRow({ staff_id: OTHER_STAFF_ID, name: "Usman", over_norm: true });

    const sorted = sortOverNormFirst([within, over, alsoWithin, alsoOver]);

    expect(sorted.map((row) => row.name)).toEqual(["Bilal", "Usman", "Ayesha", "Zainab"]);
  });

  it("does not reorder the rows it was given", () => {
    const rows = [loadRow({ name: "Ayesha" }), loadRow({ name: "Bilal", over_norm: true })];

    sortOverNormFirst(rows);

    expect(rows.map((row) => row.name)).toEqual(["Ayesha", "Bilal"]);
  });
});
