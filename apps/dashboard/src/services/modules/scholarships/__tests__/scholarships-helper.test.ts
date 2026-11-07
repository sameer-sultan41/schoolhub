import { SCHOLARSHIP_NEXT_STATES, SCHOLARSHIP_STATUSES } from "../scholarships-constant";
import {
  buildScholarshipInput,
  defaultScholarshipFormValues,
  nextScholarshipStatuses,
  scholarshipNotesRequired,
  scholarshipStatusFilter,
} from "../scholarships-helper";
import {
  createScholarshipFormSchema,
  createScholarshipStatusFormSchema,
} from "../scholarships.schema";

describe("the scholarship lifecycle", () => {
  it.each([
    ["applied", ["approved", "revoked"]],
    ["approved", ["active", "revoked"]],
    ["active", ["ended", "revoked"]],
    ["ended", []],
    ["revoked", []],
  ] as const)("a %s award may move to %j", (status, next) => {
    expect(nextScholarshipStatuses(status)).toEqual(next);
  });

  it("never offers a move back, or the status it already has", () => {
    for (const status of SCHOLARSHIP_STATUSES) {
      expect(SCHOLARSHIP_NEXT_STATES[status]).not.toContain(status);
    }
    expect(nextScholarshipStatuses("revoked")).not.toContain("active");
    expect(nextScholarshipStatuses("ended")).not.toContain("active");
  });

  it("returns no moves for a status the client does not know yet", () => {
    expect(nextScholarshipStatuses("paused" as never)).toEqual([]);
  });

  it("requires notes only to end or revoke", () => {
    expect(SCHOLARSHIP_STATUSES.filter(scholarshipNotesRequired)).toEqual(["ended", "revoked"]);
  });
});

describe("scholarship helpers", () => {
  it("maps 'all' to no status filter", () => {
    expect(scholarshipStatusFilter("all")).toBeUndefined();
    expect(scholarshipStatusFilter("active")).toBe("active");
  });

  it("builds an input that sends blank sponsor and notes as null", () => {
    expect(
      buildScholarshipInput({
        ...defaultScholarshipFormValues(),
        student: "s1",
        academic_session: "a1",
        name: " Merit ",
        value: "50",
      }),
    ).toEqual({
      studentId: "s1",
      academicSessionId: "a1",
      name: "Merit",
      scholarshipType: "merit",
      coverageType: "percent",
      value: "50",
      sponsor: null,
      status: "applied",
      notes: null,
    });
  });
});

describe("scholarship schemas", () => {
  const messages = { required: "req", invalidValue: "bad" };
  const form = createScholarshipFormSchema(messages);
  const valid = {
    ...defaultScholarshipFormValues(),
    student: "s1",
    academic_session: "a1",
    name: "Merit",
    value: "50",
  };

  it("accepts a valid award and refuses a percent over 100", () => {
    expect(form.safeParse(valid).success).toBe(true);
    const issue = form.safeParse({ ...valid, value: "150" }).error?.issues[0];
    expect(issue?.message).toBe("bad");
  });

  it("requires notes only when the status dialog says so", () => {
    expect(
      createScholarshipStatusFormSchema(messages, true).safeParse({ notes: " " }).success,
    ).toBe(false);
    expect(
      createScholarshipStatusFormSchema(messages, true).safeParse({ notes: "x" }).success,
    ).toBe(true);
    expect(
      createScholarshipStatusFormSchema(messages, false).safeParse({ notes: "" }).success,
    ).toBe(true);
  });
});
