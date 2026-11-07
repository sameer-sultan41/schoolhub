import {
  buildDiscountInput,
  canRevokeDiscount,
  defaultDiscountFormValues,
  discountStatusFilter,
  toDiscountsQueryParams,
} from "../discounts-helper";
import { createDiscountFormSchema } from "../discounts.schema";

const MESSAGES = { required: "req", invalidValue: "bad", endBeforeStart: "order" };

describe("canRevokeDiscount", () => {
  it.each([
    ["active", true],
    ["expired", false],
    ["revoked", false],
  ] as const)("a %s discount: %s", (status, expected) => {
    expect(canRevokeDiscount({ status } as Parameters<typeof canRevokeDiscount>[0])).toBe(expected);
  });
});

describe("discount query and filter helpers", () => {
  it("sends only the filters given", () => {
    expect(toDiscountsQueryParams({ studentId: "s1", search: "" })).toEqual({ student: "s1" });
  });

  it("maps 'all' to no status filter", () => {
    expect(discountStatusFilter("all")).toBeUndefined();
    expect(discountStatusFilter("revoked")).toBe("revoked");
  });
});

describe("buildDiscountInput", () => {
  it("trims, and sends a blank head, date or reason as null", () => {
    const input = buildDiscountInput({
      ...defaultDiscountFormValues(),
      student: "s1",
      academic_session: "a1",
      name: " Sibling ",
      value: " 10 ",
    });

    expect(input).toEqual({
      studentId: "s1",
      academicSessionId: "a1",
      name: "Sibling",
      discountType: "percent",
      value: "10",
      feeHeadId: null,
      validFrom: null,
      validTo: null,
      reason: null,
    });
  });
});

describe("the discount form schema", () => {
  const valid = {
    ...defaultDiscountFormValues(),
    student: "s1",
    academic_session: "a1",
    name: "Sibling",
    value: "10",
  };
  const schema = createDiscountFormSchema(MESSAGES);
  const issueAt = (values: object, path: string) =>
    schema.safeParse(values).error?.issues.find((issue) => issue.path[0] === path)?.message;

  it("accepts a valid percent", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["0", "percent"],
    ["-5", "percent"],
    ["101", "percent"],
    ["abc", "fixed"],
  ])("refuses a value of %s for a %s discount", (value, discount_type) => {
    expect(issueAt({ ...valid, value, discount_type }, "value")).toBe("bad");
  });

  it("allows a fixed amount above 100", () => {
    expect(schema.safeParse({ ...valid, discount_type: "fixed", value: "2500" }).success).toBe(
      true,
    );
  });

  it("refuses an end date before the start", () => {
    expect(
      issueAt({ ...valid, valid_from: "2026-10-10", valid_to: "2026-10-01" }, "valid_to"),
    ).toBe("order");
  });

  it("requires the student, session and name", () => {
    expect(issueAt({ ...valid, student: "" }, "student")).toBe("req");
    expect(issueAt({ ...valid, academic_session: "" }, "academic_session")).toBe("req");
    expect(issueAt({ ...valid, name: " " }, "name")).toBe("req");
  });
});
