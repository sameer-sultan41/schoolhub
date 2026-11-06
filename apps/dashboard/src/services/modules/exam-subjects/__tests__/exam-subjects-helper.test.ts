import {
  buildExamSubjectInput,
  defaultExamSubjectFormValues,
  groupByClass,
  isoToLocalInput,
  localInputToIso,
  recordToExamSubjectFormValues,
} from "../exam-subjects-helper";
import { createExamSubjectFormSchema } from "../exam-subjects.schema";
import { EXAM_ID } from "../../exams/__tests__/exams-fixtures";
import { CLASS_ID, OTHER_CLASS_ID, subjectRecord } from "./exam-subjects-fixtures";

const MESSAGES = {
  required: "required",
  marksInvalid: "marksInvalid",
  weightageInvalid: "weightageInvalid",
  passAboveMax: "passAboveMax",
  windowOrder: "windowOrder",
};
const schema = createExamSubjectFormSchema(MESSAGES);

function issuesOf(values: ReturnType<typeof defaultExamSubjectFormValues>) {
  const result = schema.safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
}

const VALID = {
  ...defaultExamSubjectFormValues(),
  class_id: CLASS_ID,
  subject_id: "s1",
  max_marks: "100",
  pass_marks: "40",
};

describe("exam subject form", () => {
  it("groups the rows by class, keeping the API's order", () => {
    const rows = [
      subjectRecord({ id: "1", subject_name: "Art" }),
      subjectRecord({ id: "2", subject_name: "Maths" }),
      subjectRecord({ id: "3", class_id: OTHER_CLASS_ID, class_name: "Grade 6" }),
    ];

    const groups = groupByClass(rows);

    expect(groups.map((group) => [group.className, group.rows.map((row) => row.id)])).toEqual([
      ["Grade 5", ["1", "2"]],
      ["Grade 6", ["3"]],
    ]);
  });

  it("asks for a practical maximum once the subject has a practical part, and not before", () => {
    expect(issuesOf(VALID)).toEqual({});
    expect(issuesOf({ ...VALID, has_practical: true })).toEqual({
      practical_max_marks: "required",
    });
    expect(
      issuesOf({
        ...VALID,
        has_practical: true,
        practical_max_marks: "30",
        practical_pass_marks: "12",
      }),
    ).toEqual({});
  });

  it("refuses pass marks above the maximum, practical or not, and a window that closes first", () => {
    expect(issuesOf({ ...VALID, pass_marks: "101" })).toEqual({ pass_marks: "passAboveMax" });
    expect(
      issuesOf({
        ...VALID,
        has_practical: true,
        practical_max_marks: "30",
        practical_pass_marks: "31",
      }),
    ).toEqual({ practical_pass_marks: "passAboveMax" });
    expect(
      issuesOf({
        ...VALID,
        marks_entry_opens_at: "2026-10-05T09:00",
        marks_entry_closes_at: "2026-10-05T08:00",
      }),
    ).toEqual({ marks_entry_closes_at: "windowOrder" });
  });

  it("sends no practical marks for a subject without a practical part", () => {
    const input = buildExamSubjectInput(EXAM_ID, {
      ...VALID,
      has_practical: false,
      practical_max_marks: "30",
      practical_pass_marks: "12",
    });

    expect(input).toMatchObject({
      examId: EXAM_ID,
      hasPractical: false,
      practicalMaxMarks: null,
      practicalPassMarks: null,
    });
  });

  it("round-trips a record through the form, practical marks included", () => {
    const record = subjectRecord({
      has_practical: true,
      practical_max_marks: "30.00",
      practical_pass_marks: "12.00",
    });

    const input = buildExamSubjectInput(EXAM_ID, recordToExamSubjectFormValues(record));

    expect(input).toMatchObject({
      classId: CLASS_ID,
      maxMarks: "100.00",
      hasPractical: true,
      practicalMaxMarks: "30.00",
      practicalPassMarks: "12.00",
    });
  });

  it("carries an entry window through a datetime-local input unchanged", () => {
    const iso = "2026-10-05T09:30:00.000Z";

    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(isoToLocalInput(null)).toBe("");
    expect(localInputToIso("")).toBeNull();
  });
});
