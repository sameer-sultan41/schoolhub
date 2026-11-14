import {
  buildProcessRefundInput,
  buildRefundDecisionInput,
  buildRequestRefundInput,
  canDecideRefund,
  canProcessRefund,
  refundableRemainder,
  refundStatusFilter,
  toProcessRefundBody,
  toRefundDecisionBody,
  toRefundsQueryParams,
  toRequestRefundBody,
} from "../refunds-helper";
import {
  createProcessRefundFormSchema,
  createRefundDecisionFormSchema,
  createRequestRefundFormSchema,
} from "../refunds.schema";

describe("canDecideRefund", () => {
  it.each([
    ["requested", "someone-else", true],
    ["requested", "me", false],
    ["approved", "someone-else", false],
    ["rejected", "someone-else", false],
    ["processed", "someone-else", false],
  ] as const)("a %s refund requested by %s, viewed by me: %s", (status, requester, expected) => {
    expect(canDecideRefund({ status, requested_by: requester }, "me")).toBe(expected);
  });

  it("offers nothing while the viewer is unknown", () => {
    expect(canDecideRefund({ status: "requested", requested_by: "someone" }, undefined)).toBe(
      false,
    );
  });
});

describe("canProcessRefund", () => {
  it.each([
    ["approved", true],
    ["requested", false],
    ["rejected", false],
    ["processed", false],
  ] as const)("a %s refund: %s", (status, expected) => {
    expect(canProcessRefund({ status })).toBe(expected);
  });
});

describe("refunds-helper", () => {
  it("sends only the filters given", () => {
    expect(toRefundsQueryParams({ status: "requested", pageSize: 25 })).toEqual({
      status: "requested",
      page_size: 25,
    });
    expect(toRefundsQueryParams({})).toEqual({});
  });

  it("builds each body in the API's names", () => {
    expect(toRequestRefundBody({ paymentId: "p1", amount: "50.00", reason: "Twice" })).toEqual({
      payment: "p1",
      amount: "50.00",
      reason: "Twice",
    });
    expect(toRefundDecisionBody({ note: "ok" })).toEqual({ note: "ok" });
    expect(toRefundDecisionBody({ note: null })).toEqual({});
    expect(toProcessRefundBody({ method: "cheque", referenceNo: "C-1" })).toEqual({
      method: "cheque",
      reference_no: "C-1",
    });
    expect(toProcessRefundBody({ method: "cash", referenceNo: null })).toEqual({ method: "cash" });
  });

  it("trims the form's values into inputs", () => {
    expect(buildRequestRefundInput("p1", { amount: " 50.00 ", reason: " Twice " })).toEqual({
      paymentId: "p1",
      amount: "50.00",
      reason: "Twice",
    });
    expect(buildRefundDecisionInput({ note: "  " })).toEqual({ note: null });
    expect(buildProcessRefundInput({ method: "cash", reference_no: " R1 " })).toEqual({
      method: "cash",
      referenceNo: "R1",
    });
  });

  it("reads the refundable remainder from a refusal's meta", () => {
    expect(refundableRemainder({ refundable_remainder: "300.00" })).toBe("300.00");
    expect(refundableRemainder({})).toBeNull();
    expect(refundableRemainder({ refundable_remainder: 300 })).toBeNull();
  });

  it("reads a status filter as the API's, or nothing for all and for a stranger", () => {
    expect(refundStatusFilter("approved")).toBe("approved");
    expect(refundStatusFilter("all")).toBeUndefined();
    expect(refundStatusFilter("lost")).toBeUndefined();
  });
});

describe("refund form schemas", () => {
  const messages = { required: "required", positive: "positive" };

  it("requires a positive amount and a reason", () => {
    const schema = createRequestRefundFormSchema(messages);
    expect(schema.safeParse({ amount: "10.50", reason: "Twice" }).success).toBe(true);
    for (const amount of ["0", "-5", "1.234", "abc"]) {
      expect(schema.safeParse({ amount, reason: "Twice" }).success).toBe(false);
    }
    expect(schema.safeParse({ amount: "10", reason: "  " }).success).toBe(false);
  });

  it("asks for a note on a rejection only", () => {
    expect(createRefundDecisionFormSchema(messages, true).safeParse({ note: "" }).success).toBe(
      false,
    );
    expect(createRefundDecisionFormSchema(messages, true).safeParse({ note: "No" }).success).toBe(
      true,
    );
    expect(createRefundDecisionFormSchema(messages, false).safeParse({ note: "" }).success).toBe(
      true,
    );
  });

  it("takes a counter method, never the gateway", () => {
    const schema = createProcessRefundFormSchema(messages);
    expect(schema.safeParse({ method: "bank_transfer", reference_no: "" }).success).toBe(true);
    expect(schema.safeParse({ method: "online_gateway", reference_no: "" }).success).toBe(false);
  });
});
