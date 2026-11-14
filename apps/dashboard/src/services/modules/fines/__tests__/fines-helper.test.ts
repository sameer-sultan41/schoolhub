import {
  buildFineInput,
  canWaiveFine,
  defaultFineFormValues,
  fineStatusFilter,
  toFinesQueryParams,
} from "../fines-helper";
import { createFineFormSchema } from "../fines.schema";

describe("canWaiveFine", () => {
  it.each([
    ["pending", true],
    ["invoiced", false],
    ["paid", false],
    ["waived", false],
  ] as const)("a %s fine: %s", (status, expected) => {
    expect(canWaiveFine({ status } as Parameters<typeof canWaiveFine>[0])).toBe(expected);
  });
});

describe("fine query and filter helpers", () => {
  it("sends only the filters given", () => {
    expect(toFinesQueryParams({ studentId: "s1", search: "" })).toEqual({ student: "s1" });
  });

  it("maps 'all' to no status filter", () => {
    expect(fineStatusFilter("all")).toBeUndefined();
    expect(fineStatusFilter("pending")).toBe("pending");
  });
});

describe("the fine form", () => {
  const schema = createFineFormSchema({ required: "req", invalidAmount: "bad" });
  const valid = {
    ...defaultFineFormValues(),
    student: "s1",
    fee_head: "h1",
    amount: "250",
    reason: " Overdue book ",
  };

  it("builds an input with the trimmed reason and amount", () => {
    expect(buildFineInput({ ...valid, amount: " 250 " })).toEqual({
      studentId: "s1",
      feeHeadId: "h1",
      fineType: "late_fee",
      amount: "250",
      reason: "Overdue book",
    });
  });

  it.each(["0", "-1", "abc"])("refuses an amount of %s", (amount) => {
    const issue = schema.safeParse({ ...valid, amount }).error?.issues[0];
    expect(issue?.message).toBe("bad");
  });

  it("requires the student, head and reason", () => {
    expect(schema.safeParse({ ...valid, student: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, fee_head: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, reason: " " }).success).toBe(false);
  });
});
