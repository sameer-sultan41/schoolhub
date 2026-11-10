import { defaultExamFormValues } from "../exams-helper";
import { createExamFormSchema } from "../exams.schema";

const MESSAGES = {
  required: "required",
  weightageInvalid: "weightageInvalid",
  endsBeforeStart: "endsBeforeStart",
  bothDates: "bothDates",
};
const schema = createExamFormSchema(MESSAGES);

const VALID = { ...defaultExamFormValues("session-1"), name: "Midterm" };

function issuesOf(weightage: string) {
  const result = schema.safeParse({ ...VALID, weightage_percent: weightage });
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("exam form weightage", () => {
  it.each(["0", "0.00", "100.01"])("refuses %s", (value) => {
    expect(issuesOf(value)).toEqual({ weightage_percent: "weightageInvalid" });
  });

  it.each(["0.5", "100"])("accepts %s", (value) => {
    expect(issuesOf(value)).toEqual({});
  });
});
