import { canVoidVoucher, voucherProviderFilter, voucherStatusFilter } from "../vouchers-helper";
import { createIssueVoucherFormSchema } from "../vouchers.schema";

describe("canVoidVoucher", () => {
  it.each([
    ["issued", true],
    ["paid", false],
    ["void", false],
    ["expired", false],
  ] as const)("a %s voucher: %s", (status, expected) => {
    expect(canVoidVoucher({ status })).toBe(expected);
  });
});

describe("voucher filters", () => {
  it("reads a URL value as the API's, or nothing for all and for a stranger", () => {
    expect(voucherStatusFilter("paid")).toBe("paid");
    expect(voucherStatusFilter("all")).toBeUndefined();
    expect(voucherStatusFilter("lost")).toBeUndefined();
    expect(voucherProviderFilter("jazzcash")).toBe("jazzcash");
    expect(voucherProviderFilter("all")).toBeUndefined();
  });
});

describe("issue voucher form schema", () => {
  const schema = createIssueVoucherFormSchema({ required: "required", validity: "validity" });

  it.each(["", "1", "30", "365"])("takes %j days", (days) => {
    expect(schema.safeParse({ provider: "bank_branch", validity_days: days }).success).toBe(true);
  });

  it.each(["0", "366", "1.5", "abc", "-3"])("refuses %j days with the validity message", (days) => {
    const result = schema.safeParse({ provider: "bank_branch", validity_days: days });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("validity");
  });

  it("refuses a provider the API does not know", () => {
    expect(schema.safeParse({ provider: "paypal", validity_days: "" }).success).toBe(false);
  });
});
