import type { CurriculumFormValues } from "../curriculum.schema";
import {
  buildCurriculumInput,
  curriculumErrorFields,
  defaultCurriculumFormValues,
  kindToIsElective,
  recordToFormValues,
  toCurriculumBody,
  toCurriculumQueryParams,
} from "../curriculum-helper";
import { CLASS_ID, SESSION_ID, SUBJECT_ID } from "@/test-fixtures/academics";
import { curriculumRecord } from "./curriculum-fixtures";

describe("toCurriculumBody", () => {
  it("maps every camelCase field to its snake_case key", () => {
    expect(
      toCurriculumBody({
        academicSessionId: "sess-1",
        classId: "class-1",
        subjectId: "subject-1",
        campusId: "campus-1",
        isElective: true,
        electiveGroup: "language",
        weeklyPeriods: 4,
        notes: "Choose one",
      }),
    ).toEqual({
      academic_session_id: "sess-1",
      class_id: "class-1",
      subject_id: "subject-1",
      campus_id: "campus-1",
      is_elective: true,
      elective_group: "language",
      weekly_periods: 4,
      notes: "Choose one",
    });
  });

  it("keeps null and false (real values) but drops undefined", () => {
    const body = toCurriculumBody({ campusId: null, isElective: false, notes: undefined });

    expect(body).toEqual({ campus_id: null, is_elective: false });
    expect(body).not.toHaveProperty("notes");
  });
});

describe("toCurriculumQueryParams", () => {
  it("always seeds page and page_size, then adds only the filters that are set", () => {
    const params = toCurriculumQueryParams({ page: 3, pageSize: 50, academicSessionId: "s1" });

    expect(params).toEqual({ page: 3, page_size: 50, academic_session_id: "s1" });
  });

  it("drops empty strings and keeps is_elective=false", () => {
    const params = toCurriculumQueryParams({
      academicSessionId: "sess-1",
      search: "",
      classId: "",
      isElective: false,
    });

    expect(params).toMatchObject({ academic_session_id: "sess-1", is_elective: false });
    expect(params).not.toHaveProperty("search");
    expect(params).not.toHaveProperty("class_id");
  });
});

describe("kindToIsElective", () => {
  it("maps core to false and elective to true, and anything else to no filter", () => {
    expect(kindToIsElective("core")).toBe(false);
    expect(kindToIsElective("elective")).toBe(true);
    expect(kindToIsElective("all")).toBeUndefined();
    expect(kindToIsElective("nonsense")).toBeUndefined();
  });
});

describe("defaultCurriculumFormValues", () => {
  it("starts on the given session, with one period a week and everything else empty", () => {
    expect(defaultCurriculumFormValues(SESSION_ID)).toEqual({
      academic_session_id: SESSION_ID,
      class_id: "",
      subject_id: "",
      campus_id: "",
      is_elective: false,
      elective_group: "",
      weekly_periods: 1,
      notes: "",
    });
  });
});

describe("recordToFormValues", () => {
  it("copies a record's own values", () => {
    const record = curriculumRecord({
      is_elective: true,
      elective_group: "Languages",
      weekly_periods: 3,
      notes: "Choose one",
    });

    expect(recordToFormValues(record)).toEqual({
      academic_session_id: SESSION_ID,
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
      campus_id: record.campus_id,
      is_elective: true,
      elective_group: "Languages",
      weekly_periods: 3,
      notes: "Choose one",
    });
  });

  it("turns a null campus, group and notes into empty strings, and fills what is unset", () => {
    const record = curriculumRecord({
      campus_id: null,
      elective_group: null,
      notes: null,
      is_elective: undefined,
      weekly_periods: undefined,
    });

    expect(recordToFormValues(record)).toMatchObject({
      campus_id: "",
      is_elective: false,
      elective_group: "",
      weekly_periods: 1,
      notes: "",
    });
  });
});

describe("buildCurriculumInput", () => {
  const values: CurriculumFormValues = {
    academic_session_id: SESSION_ID,
    class_id: CLASS_ID,
    subject_id: SUBJECT_ID,
    campus_id: "",
    is_elective: false,
    elective_group: "",
    weekly_periods: 4,
    notes: "",
  };

  it("creates with every field, sending null for all campuses and for blank text", () => {
    expect(buildCurriculumInput(values, "create")).toEqual({
      academicSessionId: SESSION_ID,
      classId: CLASS_ID,
      subjectId: SUBJECT_ID,
      campusId: null,
      isElective: false,
      electiveGroup: null,
      weeklyPeriods: 4,
      notes: null,
    });
  });

  it("keeps a chosen campus, and trims the group and notes it sends", () => {
    const input = buildCurriculumInput(
      {
        ...values,
        campus_id: "campus-1",
        is_elective: true,
        elective_group: "  Languages ",
        notes: " Choose one ",
      },
      "create",
    );

    expect(input).toMatchObject({
      campusId: "campus-1",
      isElective: true,
      electiveGroup: "Languages",
      notes: "Choose one",
    });
  });

  it("drops a group left in the form once the subject is no longer an elective", () => {
    const input = buildCurriculumInput({ ...values, elective_group: "Languages" }, "create");

    expect(input.electiveGroup).toBeNull();
  });

  it("edits with only the four fields a mapping may change", () => {
    const input = buildCurriculumInput(
      { ...values, is_elective: true, elective_group: "Languages", notes: "Note" },
      "edit",
    );

    expect(input).toEqual({
      isElective: true,
      electiveGroup: "Languages",
      weeklyPeriods: 4,
      notes: "Note",
    });
  });

  it("clears the notes on edit with null rather than leaving them out", () => {
    const input = buildCurriculumInput({ ...values, notes: "   " }, "edit");

    expect(input).toHaveProperty("notes", null);
  });
});

describe("curriculumErrorFields", () => {
  it("lets a create show an error under any input it has, the group's included", () => {
    expect(curriculumErrorFields("create", true)).toEqual([
      "class_id",
      "subject_id",
      "elective_group",
      "weekly_periods",
      "notes",
    ]);
  });

  it("leaves out the identity fields on an edit", () => {
    expect(curriculumErrorFields("edit", true)).toEqual([
      "elective_group",
      "weekly_periods",
      "notes",
    ]);
  });

  it("leaves out the group once the switch is off, as its input is not on the form", () => {
    expect(curriculumErrorFields("edit", false)).toEqual(["weekly_periods", "notes"]);
    expect(curriculumErrorFields("create", false)).not.toContain("elective_group");
  });
});
