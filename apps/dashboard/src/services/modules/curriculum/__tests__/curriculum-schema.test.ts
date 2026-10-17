import {
  createCloneCurriculumFormSchema,
  createCurriculumFormSchema,
  curriculumFormSchema,
  type CurriculumFormValues,
} from "../curriculum.schema";
import { CLASS_ID, SESSION_ID, SUBJECT_ID } from "@/test-fixtures/academics";

const VALID: CurriculumFormValues = {
  academic_session_id: SESSION_ID,
  class_id: CLASS_ID,
  subject_id: SUBJECT_ID,
  campus_id: "",
  is_elective: false,
  elective_group: "",
  weekly_periods: 3,
  notes: "",
};

const MESSAGES = {
  required: "Pick one.",
  electiveGroupRequired: "Name the group.",
  weeklyPeriodsInvalid: "Whole number, at least 1.",
};

/** The message of the first issue `schema` finds on each field of `values`. */
function issuesOf(schema: typeof curriculumFormSchema, values: unknown): Record<string, string> {
  const result = schema.safeParse(values);
  if (result.success) return {};
  const issues: Record<string, string> = {};
  for (const issue of result.error.issues) {
    issues[issue.path.join(".")] ??= issue.message;
  }
  return issues;
}

describe("curriculumFormSchema", () => {
  it("accepts a complete mapping, for all campuses or for one", () => {
    expect(issuesOf(curriculumFormSchema, VALID)).toEqual({});
    expect(issuesOf(curriculumFormSchema, { ...VALID, campus_id: "campus-1" })).toEqual({});
  });

  it("uses the bare message keys, for a caller that translates them itself", () => {
    const issues = issuesOf(curriculumFormSchema, { ...VALID, class_id: "", is_elective: true });

    expect(issues).toEqual({ class_id: "required", elective_group: "electiveGroupRequired" });
  });

  it("requires a group for an elective, but not for a core subject", () => {
    const schema = createCurriculumFormSchema(MESSAGES);
    const named = { ...VALID, is_elective: true, elective_group: "Languages" };

    expect(issuesOf(schema, { ...VALID, is_elective: true })).toEqual({
      elective_group: "Name the group.",
    });
    expect(issuesOf(schema, { ...named, elective_group: "   " })).toEqual({
      elective_group: "Name the group.",
    });
    expect(issuesOf(schema, named)).toEqual({});
    expect(issuesOf(schema, VALID)).toEqual({});
  });

  it("asks for the session, class and subject with the required message", () => {
    const schema = createCurriculumFormSchema(MESSAGES);
    const issues = issuesOf(schema, {
      ...VALID,
      academic_session_id: "",
      class_id: "not-an-id",
      subject_id: "",
    });

    expect(issues).toEqual({
      academic_session_id: "Pick one.",
      class_id: "Pick one.",
      subject_id: "Pick one.",
    });
  });

  it.each([0, -2, 2.5, Number.NaN])("rejects %p weekly periods with its own message", (value) => {
    const schema = createCurriculumFormSchema(MESSAGES);

    expect(issuesOf(schema, { ...VALID, weekly_periods: value })).toEqual({
      weekly_periods: "Whole number, at least 1.",
    });
  });

  it("limits the group and the notes to the lengths the columns hold", () => {
    const longNotes = issuesOf(curriculumFormSchema, { ...VALID, notes: "n".repeat(501) });
    const longGroup = issuesOf(curriculumFormSchema, {
      ...VALID,
      is_elective: true,
      elective_group: "g".repeat(51),
    });

    expect(issuesOf(curriculumFormSchema, { ...VALID, notes: "n".repeat(500) })).toEqual({});
    expect(longNotes).toHaveProperty("notes");
    expect(longGroup).toHaveProperty("elective_group");
  });
});

describe("createCloneCurriculumFormSchema", () => {
  const schema = createCloneCurriculumFormSchema("Pick one.");

  it("needs both sessions, with the given message", () => {
    const result = schema.safeParse({
      source_academic_session_id: "",
      target_academic_session_id: SESSION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["Pick one."]);
  });

  it("accepts two session ids", () => {
    const result = schema.safeParse({
      source_academic_session_id: CLASS_ID,
      target_academic_session_id: SESSION_ID,
    });

    expect(result.success).toBe(true);
  });
});
