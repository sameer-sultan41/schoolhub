import { COUNTER_PAYMENT_METHODS } from "../payments-constant";
import {
  buildRecordPaymentInput,
  canRequestRefund,
  cashierFilterId,
  defaultRecordPaymentFormValues,
  needsReference,
  paidAtBounds,
  paymentMethodFilter,
  paymentStatusFilter,
  toPaymentsQueryParams,
} from "../payments-helper";
import { createRecordPaymentFormSchema } from "../payments.schema";

const schema = createRecordPaymentFormSchema({
  required: "required",
  positive: "positive",
  reference: "reference",
});

describe("payments-helper", () => {
  it("sends only the filters given", () => {
    expect(toPaymentsQueryParams({ studentId: "s1", method: "card", pageSize: 25 })).toEqual({
      student: "s1",
      method: "card",
      page_size: 25,
    });
    expect(toPaymentsQueryParams({})).toEqual({});
  });

  it("offers every method but the gateway", () => {
    expect(COUNTER_PAYMENT_METHODS).toEqual(["cash", "cheque", "bank_transfer", "card"]);
  });

  it("starts at the whole balance in cash and trims what is sent", () => {
    const values = defaultRecordPaymentFormValues("1350.00");
    expect(values).toEqual({ amount: "1350.00", method: "cash", reference_no: "" });
    expect(buildRecordPaymentInput("i1", { ...values, reference_no: "  " })).toEqual({
      feeInvoiceId: "i1",
      amount: "1350.00",
      method: "cash",
      referenceNo: null,
    });
  });

  it("needs a reference for a cheque or transfer only", () => {
    expect(needsReference("cheque")).toBe(true);
    expect(needsReference("bank_transfer")).toBe(true);
    expect(needsReference("cash")).toBe(false);
    expect(needsReference("card")).toBe(false);
  });

  it("rejects a zero, negative or three-decimal amount and a cheque with no reference", () => {
    const base = { amount: "10.00", method: "cash", reference_no: "" };
    expect(schema.safeParse(base).success).toBe(true);
    for (const amount of ["0", "-5", "1.234", "abc", ""]) {
      expect(schema.safeParse({ ...base, amount }).success).toBe(false);
    }
    expect(schema.safeParse({ ...base, method: "cheque" }).success).toBe(false);
    expect(schema.safeParse({ ...base, method: "cheque", reference_no: "CHQ-1" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...base, method: "online_gateway" }).success).toBe(false);
  });
});

describe("payments list filters", () => {
  describe("paidAtBounds", () => {
    // Jest runs in America/New_York (`jest.global-setup.ts`): setting `process.env.TZ` inside a
    // test does not move the zone, so these read the viewer's local days from that one.
    it("sends offset-aware instants for the viewer's local days, the upper one exclusive", () => {
      // 1 October starts at 04:00 UTC (EDT, UTC-4); the day after 31 October is 1 November,
      // which still starts in EDT (the clocks go back at 02:00 that day).
      expect(paidAtBounds("2026-10-01", "2026-10-31")).toEqual({
        paidAtGte: "2026-10-01T04:00:00.000Z",
        paidAtLt: "2026-11-01T04:00:00.000Z",
      });
    });

    it("makes a single day a half-open range of one local day", () => {
      expect(paidAtBounds("2026-10-01", "2026-10-01")).toEqual({
        paidAtGte: "2026-10-01T04:00:00.000Z",
        paidAtLt: "2026-10-02T04:00:00.000Z",
      });
    });

    it("sends nothing for a bound that is not set", () => {
      expect(paidAtBounds("", "")).toEqual({ paidAtGte: undefined, paidAtLt: undefined });
    });
  });

  it("resolves the cashier filter: me is the viewer, an id is itself, blank is none", () => {
    expect(cashierFilterId("me", "u1")).toBe("u1");
    expect(cashierFilterId("me", undefined)).toBeUndefined();
    expect(cashierFilterId("u2", "u1")).toBe("u2");
    expect(cashierFilterId("", "u1")).toBeUndefined();
  });

  it("reads method and status as the API's, or nothing for all and for a stranger", () => {
    expect(paymentMethodFilter("cheque")).toBe("cheque");
    expect(paymentMethodFilter("all")).toBeUndefined();
    expect(paymentMethodFilter("barter")).toBeUndefined();
    expect(paymentStatusFilter("reversed")).toBe("reversed");
    expect(paymentStatusFilter("all")).toBeUndefined();
  });
});

describe("canRequestRefund", () => {
  it.each([
    ["confirmed", true],
    ["pending", false],
    ["failed", false],
    ["reversed", false],
  ] as const)("a %s payment: %s", (status, expected) => {
    expect(canRequestRefund({ status })).toBe(expected);
  });
});
