import { COUNTER_PAYMENT_METHODS } from "../payments-constant";
import {
  buildRecordPaymentInput,
  defaultRecordPaymentFormValues,
  needsReference,
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
