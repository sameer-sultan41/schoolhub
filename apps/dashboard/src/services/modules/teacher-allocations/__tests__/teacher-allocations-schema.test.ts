import { CLASS_ID, SUBJECT_ID } from "@/test-fixtures/academics";
import {
  allocationEditFormSchema,
  allocationFormSchema,
  createAllocationFormSchema,
  type AllocationFormValues,
} from "../teacher-allocations.schema";
import { SECTION_ID, STAFF_ID } from "./teacher-allocations-fixtures";

const VALID: AllocationFormValues = {
  class_id: CLASS_ID,
  section_id: SECTION_ID,
  subject_id: SUBJECT_ID,
  staff_id: STAFF_ID,
  is_primary: true,
  weekly_periods: "",
  effective_from: "",
};

const MESSAGES = { required: "Pick one.", weeklyPeriodsInvalid: "Whole number, at least 1." };

/** The message of the first issue `schema` finds on each field of `values`. */
function issuesOf(schema: typeof allocationFormSchema, values: unknown): Record<string, string> {
  const result = schema.safeParse(values);
  if (result.success) return {};
  const issues: Record<string, string> = {};
  for (const issue of result.error.issues) {
    issues[issue.path.join(".")] ??= issue.message;
  }
  return issues;
}

describe("allocationFormSchema", () => {
  it("accepts a complete allocation, with or without an override and a start date", () => {
    expect(issuesOf(allocationFormSchema, VALID)).toEqual({});
    expect(
      issuesOf(allocationFormSchema, {
        ...VALID,
        is_primary: false,
        weekly_periods: "6",
        effective_from: "2026-09-01",
      }),
    ).toEqual({});
  });

  it("asks for the class, section, subject and teacher", () => {
    const issues = issuesOf(createAllocationFormSchema(MESSAGES), {
      ...VALID,
      class_id: "",
      section_id: "",
      subject_id: "",
      staff_id: "",
    });

    expect(issues).toEqual({
      class_id: MESSAGES.required,
      section_id: MESSAGES.required,
      subject_id: MESSAGES.required,
      staff_id: MESSAGES.required,
    });
  });

  it.each(["0", "-3", "2.5", "1e2", "abc", " 3"])("rejects %p periods", (weeklyPeriods) => {
    const issues = issuesOf(createAllocationFormSchema(MESSAGES), {
      ...VALID,
      weekly_periods: weeklyPeriods,
    });

    expect(issues).toEqual({ weekly_periods: MESSAGES.weeklyPeriodsInvalid });
  });

  it.each(["1", "6", "30"])("accepts %p periods", (weeklyPeriods) => {
    expect(issuesOf(allocationFormSchema, { ...VALID, weekly_periods: weeklyPeriods })).toEqual({});
  });
});

describe("allocationEditFormSchema", () => {
  it("checks only the three editable fields", () => {
    const edit = { is_primary: false, weekly_periods: "", effective_from: "" };

    expect(allocationEditFormSchema.safeParse(edit).success).toBe(true);
    expect(allocationEditFormSchema.safeParse({ ...edit, weekly_periods: "0" }).success).toBe(
      false,
    );
  });
});
