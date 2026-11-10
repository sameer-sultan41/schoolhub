import { expect, test } from "@/fixtures";
import {
  buildRole,
  buildUser,
  FEES_COUNTER_PERMISSIONS,
  FEES_INVOICING_PERMISSIONS,
  FEES_PAYMENTS_ACCOUNTANT_PERMISSIONS,
  FEES_PAYMENTS_STAFF_PERMISSIONS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildFeeInvoice,
  buildFeePayment,
  buildFeeRefund,
  buildFeeVoucher,
  buildStudent,
  feesCollectionModule,
  feesInvoicingModule,
  type FeeInvoice,
  type FeePayment,
  type FeeRefund,
  type IssuedReceipt,
  type FeesCollectionOptions,
  type FeeSettlementImport,
  type FeeVoucher,
  jobsModule,
  type JobStub,
  type MockApi,
  studentsModule,
} from "@/mocks";

/**
 * The fee counter (PR C) against a stubbed API: `/fees/counter`, a student's outstanding invoices
 * and the Record payment dialog with its receipt panel. The stub (`feesCollectionModule`)
 * enforces the server's rules the screen surfaces (L5): a payment over the balance is refused
 * under `amount`, a canceled invoice takes none, the invoice's balance moves by the server's own
 * sums, and one `Idempotency-Key` replays one payment. Whether the server really does is the live
 * lane's (`tests/live/api/fees-collection.spec.ts`).
 */

const ayesha = buildStudent({ id: uuid(), first_name: "Ayesha", last_name: "Khan" });

// The seeded `finance_staff`'s keys for the counter, no wider (L55).
const financeStaff = buildUser({
  roles: [buildRole({ slug: "finance_staff", name: "Finance staff" })],
  permissions: FEES_COUNTER_PERMISSIONS,
});

const RECORD_PATH = /\/payments:record$/;
const RECEIPT_PATH = /\/receipts\/[^/]+\/download$/;

function owing(overrides: Partial<FeeInvoice> = {}): FeeInvoice {
  return buildFeeInvoice({
    invoice_no: "INV-E2E-0001",
    student: ayesha.id,
    student_name: "Ayesha Khan",
    subtotal: "1500.00",
    balance_due: "1350.00",
    paid_total: "150.00",
    status: "partially_paid",
    ...overrides,
  });
}

function stubCounterApi(mockApi: MockApi, invoices: FeeInvoice[]) {
  const payments: FeePayment[] = [];
  const downloads: NonNullable<FeesCollectionOptions["downloads"]> = [];
  mockApi.use(
    studentsModule({ students: [ayesha] }),
    feesInvoicingModule({ invoices, payments }),
    feesCollectionModule({ invoices, payments, downloads }),
  );
  return { payments, downloads };
}

test.describe("finance staff at the counter", () => {
  test.use({ authUser: financeStaff });

  test("take a payment for a student's invoice, then print its receipt", async ({
    page,
    mockApi,
    feeCounterPage,
    signedIn: _signedIn,
  }) => {
    const invoice = owing();
    const { payments, downloads } = stubCounterApi(mockApi, [
      invoice,
      owing({
        invoice_no: "INV-E2E-0002",
        status: "paid",
        paid_total: "1500.00",
        balance_due: "0.00",
      }),
    ]);
    await feeCounterPage.goto();
    await feeCounterPage.pickStudent("Ayesha", "Ayesha Khan");

    // Only the invoice still owing money is listed, with the server's balance.
    await expect(feeCounterPage.row("INV-E2E-0001")).toContainText("1,350.00");
    await expect(feeCounterPage.row("INV-E2E-0002")).toHaveCount(0);

    await feeCounterPage.recordButton("INV-E2E-0001").click();
    const dialog = feeCounterPage.dialog("INV-E2E-0001");
    // The amount starts at the balance; over it the server's refusal shows under the amount.
    await expect(feeCounterPage.amount(dialog)).toHaveValue("1350.00");
    await feeCounterPage.amount(dialog).fill("2000.00");
    await feeCounterPage.submit(dialog).click();
    await expect(
      dialog.getByText("2000.00 exceeds the 1350.00 outstanding on INV-E2E-0001."),
    ).toBeVisible();
    expect(payments).toHaveLength(0);

    // A part payment goes through with one Idempotency-Key and shows the receipt.
    await feeCounterPage.amount(dialog).fill("500.00");
    const recorded = page.waitForRequest((r) => isApiCall(r, "POST", RECORD_PATH));
    await feeCounterPage.submit(dialog).click();
    const request = await recorded;
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON()).toEqual({
      fee_invoice: invoice.id,
      amount: "500.00",
      method: "cash",
    });
    await expect(
      dialog.getByText("Payment of 500.00 recorded. Receipt RCT-E2E-0001."),
    ).toBeVisible();

    // Print thermal streams the receipt in that layout and saves it.
    const download = page.waitForEvent("download");
    const fetched = page.waitForRequest((r) => isApiCall(r, "GET", RECEIPT_PATH));
    await feeCounterPage.printButton(dialog, "thermal").click();
    expect((await download).suggestedFilename()).toBe("RCT-E2E-0001-thermal.pdf");
    expect(new URL((await fetched).url()).searchParams.get("format")).toBe("thermal");
    expect(downloads.map((entry) => entry.format)).toContain("thermal");

    // Done closes the dialog; the list reloaded behind it with the server's new balance.
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(feeCounterPage.row("INV-E2E-0001")).toContainText("850.00");
    await expect(feeCounterPage.row("INV-E2E-0001")).toContainText("Partially paid");
  });

  test("a cheque needs its reference", async ({
    page,
    mockApi,
    feeCounterPage,
    signedIn: _signedIn,
  }) => {
    stubCounterApi(mockApi, [owing()]);
    await feeCounterPage.goto();
    await feeCounterPage.pickStudent("Ayesha", "Ayesha Khan");
    await feeCounterPage.recordButton("INV-E2E-0001").click();
    const dialog = feeCounterPage.dialog("INV-E2E-0001");

    // The gateway is never offered: the server refuses it at this endpoint.
    await feeCounterPage.methodSelect(dialog).click();
    await expect(page.getByRole("option")).toHaveText(["Cash", "Cheque", "Bank transfer", "Card"]);
    await page.getByRole("option", { name: "Cheque", exact: true }).click();

    await feeCounterPage.submit(dialog).click();
    await expect(dialog.getByText("Enter the cheque or transfer reference.")).toBeVisible();

    await dialog.getByLabel("Reference number", { exact: true }).fill("CHQ-100");
    const recorded = page.waitForRequest((r) => isApiCall(r, "POST", RECORD_PATH));
    await feeCounterPage.submit(dialog).click();
    expect((await recorded).postDataJSON()).toMatchObject({
      method: "cheque",
      reference_no: "CHQ-100",
    });
    await expect(dialog.getByText(/Payment of 1,350.00 recorded/)).toBeVisible();
  });

  test("is refused a payment on an invoice canceled after the page loaded", async ({
    mockApi,
    feeCounterPage,
    signedIn: _signedIn,
  }) => {
    const invoice = owing();
    stubCounterApi(mockApi, [invoice]);
    await feeCounterPage.goto();
    await feeCounterPage.pickStudent("Ayesha", "Ayesha Khan");
    await feeCounterPage.recordButton("INV-E2E-0001").click();
    const dialog = feeCounterPage.dialog("INV-E2E-0001");

    // Another cashier's cancel lands while the dialog is open: the server refuses, the dialog says why.
    invoice.status = "canceled";
    await feeCounterPage.submit(dialog).click();

    await expect(dialog.getByText("INV-E2E-0001 is canceled and takes no payment.")).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe("a collector without the student read", () => {
  test.use({
    authUser: buildUser({
      roles: [buildRole({ slug: "finance_staff", name: "Finance staff" })],
      permissions: ["fees.payment.collect", "fees.invoice.view"],
    }),
  });

  test("is told why the counter is closed, not shown a picker that fails", async ({
    page,
    mockApi,
    feeCounterPage,
    signedIn: _signedIn,
  }) => {
    stubCounterApi(mockApi, [owing()]);
    await feeCounterPage.goto();

    await expect(page.getByText("The counter isn't available to you")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose a student" })).toHaveCount(0);
  });
});

test.describe("an invoice reader", () => {
  test.use({
    authUser: buildUser({
      roles: [buildRole({ slug: "principal", name: "Principal" })],
      permissions: FEES_INVOICING_PERMISSIONS,
    }),
  });

  test("has no Counter tab without the collect key", async ({
    page,
    mockApi,
    feeCounterPage,
    signedIn: _signedIn,
  }) => {
    stubCounterApi(mockApi, [owing()]);
    await feeCounterPage.goto({ path: "/fees/invoices" });

    // The section tabs, not the sidebar (which also links Invoices).
    const tabs = page.getByRole("navigation", { name: "Fees & Finance sections" });
    await expect(tabs.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Counter" })).toHaveCount(0);
  });
});

/**
 * The Payments page and the invoice page's collection actions (PR C, task C3), against a stub
 * that enforces the server's refusals (L5): a refund requested by the signed-in user cannot be
 * approved by them, a paid voucher cannot be voided, a refund over what is still refundable is a
 * 422 with `meta.refundable_remainder`, a settlement row with no open voucher is an exception.
 */

const accountant = buildUser({
  roles: [buildRole({ slug: "accountant", name: "Accountant" })],
  permissions: FEES_PAYMENTS_ACCOUNTANT_PERMISSIONS,
});
const someoneElse = uuid();

function stubPaymentsApi(
  mockApi: MockApi,
  state: {
    invoices?: FeeInvoice[];
    payments?: FeePayment[];
    vouchers?: FeeVoucher[];
    refunds?: FeeRefund[];
    imports?: FeeSettlementImport[];
    receipts?: IssuedReceipt[];
    actorId: string;
  },
) {
  const invoices = state.invoices ?? [];
  const payments = state.payments ?? [];
  const vouchers = state.vouchers ?? [];
  const refunds = state.refunds ?? [];
  const imports = state.imports ?? [];
  const receipts = state.receipts ?? [];
  const jobs: Record<string, JobStub[]> = {};
  mockApi.use(
    studentsModule({ students: [ayesha] }),
    feesInvoicingModule({ invoices, payments, vouchers }),
    feesCollectionModule({
      invoices,
      payments,
      receipts,
      vouchers,
      refunds,
      imports,
      jobs,
      actorId: state.actorId,
    }),
    jobsModule({ jobs }),
  );
  return { invoices, payments, vouchers, refunds, imports };
}

test.describe("the payments page, as the accountant", () => {
  test.use({ authUser: accountant });

  test("filters payments by method and cashier, and by a day range", async ({
    page,
    mockApi,
    feePaymentsPage,
    signedIn: _signedIn,
  }) => {
    const invoice = owing();
    stubPaymentsApi(mockApi, {
      invoices: [invoice],
      payments: [
        buildFeePayment({
          fee_invoice: invoice.id,
          student: ayesha.id,
          receipt_no: "RCT-CASH",
          method: "cash",
          received_by: accountant.id,
        }),
        buildFeePayment({
          fee_invoice: invoice.id,
          student: ayesha.id,
          receipt_no: "RCT-CHEQUE",
          method: "cheque",
          received_by: someoneElse,
        }),
      ],
      actorId: accountant.id,
    });
    await feePaymentsPage.gotoTab("payments");
    await expect(feePaymentsPage.row("payments", "RCT-CASH")).toBeVisible();
    await expect(feePaymentsPage.row("payments", "RCT-CHEQUE")).toBeVisible();

    const byMethod = page.waitForRequest(
      (r) => isApiCall(r, "GET", /\/payments$/) && r.url().includes("method=cheque"),
    );
    await feePaymentsPage.select("Method").click();
    await feePaymentsPage.option("Cheque").click();
    await byMethod;
    await expect(feePaymentsPage.row("payments", "RCT-CASH")).toHaveCount(0);
    await expect(feePaymentsPage.row("payments", "RCT-CHEQUE")).toBeVisible();

    // "My collections" is the signed-in cashier's own id, sent as `received_by`.
    await feePaymentsPage.select("Method").click();
    await feePaymentsPage.option("All").click();
    const byCashier = page.waitForRequest(
      (r) =>
        isApiCall(r, "GET", /\/payments$/) &&
        new URL(r.url()).searchParams.get("received_by") === accountant.id,
    );
    await feePaymentsPage.select("Cashier").click();
    await feePaymentsPage.option("My collections").click();
    await byCashier;
    await expect(feePaymentsPage.row("payments", "RCT-CASH")).toBeVisible();
    await expect(feePaymentsPage.row("payments", "RCT-CHEQUE")).toHaveCount(0);

    // A day range bounds `paid_at` by the whole of each day.
    const ranged = page.waitForRequest((r) => {
      if (!isApiCall(r, "GET", /\/payments$/)) return false;
      const params = new URL(r.url()).searchParams;
      return (
        // Offset-aware instants (the browser's local midnights), the upper one exclusive.
        /^2026-(09-30|10-01)T.*Z$/.test(params.get("paid_at__gte") ?? "") &&
        /^2026-(10-31|11-01)T.*Z$/.test(params.get("paid_at__lt") ?? "") &&
        !params.has("paid_at__lte")
      );
    });
    await feePaymentsPage.dateFilter("Paid from").fill("2026-10-01");
    await feePaymentsPage.dateFilter("Paid to").fill("2026-10-31");
    await ranged;
  });

  test("approve then process a refund someone else requested", async ({
    page,
    mockApi,
    feePaymentsPage,
    signedIn: _signedIn,
  }) => {
    const refund = buildFeeRefund({
      amount: "200.00",
      reason: "Charged twice",
      requested_by: someoneElse,
    });
    const { refunds } = stubPaymentsApi(mockApi, { refunds: [refund], actorId: accountant.id });
    await feePaymentsPage.gotoTab("refunds");
    await expect(feePaymentsPage.row("refunds", "Charged twice")).toContainText("Requested");

    await feePaymentsPage.button("Approve the refund of 200.00").click();
    const approve = feePaymentsPage.dialog("Approve refund of 200.00");
    await approve.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(feePaymentsPage.row("refunds", "Charged twice")).toContainText("Approved");
    expect(refunds[0]?.status).toBe("approved");

    // Process holds one Idempotency-Key and pays it out by the chosen method.
    await feePaymentsPage.button("Process the refund of 200.00").click();
    const process = feePaymentsPage.dialog("Process refund of 200.00");
    await process.getByLabel("Reference (optional)").fill("BANK-77");
    const processed = page.waitForRequest((r) => isApiCall(r, "POST", /\/refunds\/[^/]+:process$/));
    await process.getByRole("button", { name: "Process refund", exact: true }).click();
    const request = await processed;
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON()).toEqual({ method: "cash", reference_no: "BANK-77" });
    await expect(feePaymentsPage.row("refunds", "Charged twice")).toContainText("Processed");
  });

  test("offers no Approve or Reject on a refund the signed-in user requested", async ({
    mockApi,
    feePaymentsPage,
    signedIn: _signedIn,
  }) => {
    stubPaymentsApi(mockApi, {
      refunds: [buildFeeRefund({ amount: "200.00", requested_by: accountant.id })],
      actorId: accountant.id,
    });
    await feePaymentsPage.gotoTab("refunds");

    await expect(feePaymentsPage.row("refunds", "Charged twice")).toBeVisible();
    await expect(feePaymentsPage.button(/Approve the refund/)).toHaveCount(0);
    await expect(feePaymentsPage.button(/Reject the refund/)).toHaveCount(0);
  });

  test("a rejection needs its note", async ({ mockApi, feePaymentsPage, signedIn: _signedIn }) => {
    stubPaymentsApi(mockApi, {
      refunds: [buildFeeRefund({ amount: "200.00", requested_by: someoneElse })],
      actorId: accountant.id,
    });
    await feePaymentsPage.gotoTab("refunds");

    await feePaymentsPage.button("Reject the refund of 200.00").click();
    const dialog = feePaymentsPage.dialog("Reject refund of 200.00");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(dialog.getByText("This field is required.")).toBeVisible();
    await dialog.getByLabel("Note", { exact: true }).fill("Refunded in cash already");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(feePaymentsPage.row("refunds", "Charged twice")).toContainText("Rejected");
  });

  test("void an issued voucher with a reason, but not one that was paid meanwhile", async ({
    mockApi,
    feePaymentsPage,
    signedIn: _signedIn,
  }) => {
    const issued = buildFeeVoucher({ consumer_number: "1111111111", status: "issued" });
    const racing = buildFeeVoucher({ consumer_number: "2222222222", status: "issued" });
    const paid = buildFeeVoucher({ consumer_number: "3333333333", status: "paid" });
    stubPaymentsApi(mockApi, { vouchers: [issued, racing, paid], actorId: accountant.id });
    await feePaymentsPage.gotoTab("vouchers");

    // Void is offered on an issued slip only: a paid one is refused, so no button.
    await expect(feePaymentsPage.button("Void voucher 3333333333")).toHaveCount(0);
    await feePaymentsPage.button("Void voucher 1111111111").click();
    const dialog = feePaymentsPage.dialog("Void voucher 1111111111");
    await dialog.getByRole("button", { name: "Void voucher", exact: true }).click();
    await expect(dialog.getByText("This field is required.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Wrong family");
    await dialog.getByRole("button", { name: "Void voucher", exact: true }).click();
    // Voided: the row's status changes and the slip is no longer offered a Void.
    await expect(feePaymentsPage.button("Void voucher 1111111111")).toHaveCount(0);
    await expect(
      feePaymentsPage.row("vouchers", "1111111111").getByText("Void", { exact: true }),
    ).toBeVisible();

    // A bank settled the other slip after this page loaded: the server's refusal shows inline.
    racing.status = "paid";
    await feePaymentsPage.button("Void voucher 2222222222").click();
    const second = feePaymentsPage.dialog("Void voucher 2222222222");
    await second.getByLabel("Reason").fill("Printed twice");
    await second.getByRole("button", { name: "Void voucher", exact: true }).click();
    await expect(
      second.getByText("A paid voucher cannot be voided. Refund the payment instead."),
    ).toBeVisible();
  });

  test("download a receipt and a voucher in the thermal layout", async ({
    page,
    mockApi,
    feePaymentsPage,
    signedIn: _signedIn,
  }) => {
    const invoice = owing();
    const payment = buildFeePayment({
      fee_invoice: invoice.id,
      student: ayesha.id,
      receipt: uuid(),
      receipt_no: "RCT-DL",
    });
    const voucher = buildFeeVoucher({ consumer_number: "4444444444" });
    stubPaymentsApi(mockApi, {
      invoices: [invoice],
      payments: [payment],
      // The receipt a payment names has to exist for its download to stream.
      receipts: [{ id: payment.receipt ?? "", receiptNo: "RCT-DL", paymentId: payment.id }],
      vouchers: [voucher],
      actorId: accountant.id,
    });
    await feePaymentsPage.gotoTab("vouchers");
    const download = page.waitForEvent("download");
    await feePaymentsPage.button("Download 4444444444 as thermal print").click();
    expect((await download).suggestedFilename()).toBe("4444444444-thermal.pdf");

    await feePaymentsPage.gotoTab("receipts");
    const receiptDownload = page.waitForEvent("download");
    await feePaymentsPage.button("Download RCT-DL as PDF").click();
    expect((await receiptDownload).suggestedFilename()).toBe("RCT-DL-pdf.pdf");
  });

  test("upload a settlement file and read its exceptions", async ({
    page,
    mockApi,
    feePaymentsPage,
    signedIn: _signedIn,
  }) => {
    const invoice = owing();
    const voucher = buildFeeVoucher({
      fee_invoice: invoice.id,
      student: ayesha.id,
      provider: "easypaisa",
      consumer_number: "1234567890",
      amount: "1350.00",
    });
    const { vouchers, payments } = stubPaymentsApi(mockApi, {
      invoices: [invoice],
      vouchers: [voucher],
      actorId: accountant.id,
    });
    await feePaymentsPage.gotoTab("imports");

    await feePaymentsPage.button("Upload settlement file").click();
    const dialog = feePaymentsPage.dialog("Upload settlement file");
    await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
    await feePaymentsPage.option("Easypaisa").click();
    await dialog.getByLabel("Settlement file").setInputFiles({
      name: "settlement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "consumer_number,transaction_reference,amount,paid_on",
          "1234567890,TXN-1,1350.00,2026-10-06",
          "9999999999,TXN-2,900.00,2026-10-06",
        ].join("\n"),
      ),
    });
    const uploaded = page.waitForRequest((r) =>
      isApiCall(r, "POST", /\/voucher-collection-imports$/),
    );
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    expect((await uploaded).headers()["idempotency-key"]).toBeTruthy();

    // The job runs, then ends with the server's counts: one row posted, one exception.
    await expect(dialog.getByText("Reconciling the file… 40%")).toBeVisible();
    await expect(dialog.getByText("1 of 2 rows matched and posted.")).toBeVisible();
    expect(vouchers[0]?.status).toBe("paid");
    expect(payments).toHaveLength(1);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();

    // The import's sheet lists the row that did not post, with the server's reason.
    await feePaymentsPage.button(/View the import uploaded/).click();
    const sheet = feePaymentsPage.dialog("Settlement import");
    await expect(
      sheet.getByText("No open voucher with consumer number '9999999999' for easypaisa."),
    ).toBeVisible();
    await expect(sheet.getByText("TXN-2")).toBeVisible();
  });
});

test.describe("the invoice page, as the accountant", () => {
  test.use({ authUser: accountant });

  test("request a refund: an over-limit amount is refused with the remainder, a valid one awaits approval", async ({
    page,
    mockApi,
    feeInvoicesPage,
    signedIn: _signedIn,
  }) => {
    const invoice = owing({ paid_total: "500.00", balance_due: "1000.00" });
    const payment = buildFeePayment({
      fee_invoice: invoice.id,
      student: ayesha.id,
      amount: "500.00",
      receipt_no: "RCT-REF",
      receipt: uuid(),
    });
    const { refunds } = stubPaymentsApi(mockApi, {
      invoices: [invoice],
      payments: [payment],
      refunds: [
        buildFeeRefund({ payment: payment.id, amount: "200.00", requested_by: someoneElse }),
      ],
      actorId: accountant.id,
    });
    await feeInvoicesPage.gotoInvoice(invoice.id);

    await page.getByRole("button", { name: "Request a refund for receipt RCT-REF" }).click();
    const dialog = page.getByRole("dialog", { name: "Request refund: RCT-REF", exact: true });
    // 200.00 of the 500.00 is already asked for, so 300.00 is what is left.
    await dialog.getByLabel("Amount to refund").fill("400.00");
    await dialog.getByLabel("Reason").fill("Charged twice");
    await dialog.getByRole("button", { name: "Request refund", exact: true }).click();
    await expect(
      dialog.getByText("400.00 exceeds the 300.00 still refundable on this payment."),
    ).toBeVisible();
    await expect(
      dialog.getByText("At most 300.00 can still be refunded on this payment."),
    ).toBeVisible();
    expect(refunds).toHaveLength(1);

    await dialog.getByLabel("Amount to refund").fill("300.00");
    const requested = page.waitForRequest((r) => isApiCall(r, "POST", /\/refunds:create$/));
    await dialog.getByRole("button", { name: "Request refund", exact: true }).click();
    const request = await requested;
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON()).toEqual({
      payment: payment.id,
      amount: "300.00",
      reason: "Charged twice",
    });
    await expect(
      dialog.getByText("Refund of 300.00 requested. It now awaits an approver."),
    ).toBeVisible();
    expect(refunds).toHaveLength(2);
  });

  test("record a payment and issue a voucher from the invoice", async ({
    page,
    mockApi,
    feeInvoicesPage,
    signedIn: _signedIn,
  }) => {
    const invoice = owing();
    const { payments, vouchers } = stubPaymentsApi(mockApi, {
      invoices: [invoice],
      actorId: accountant.id,
    });
    await feeInvoicesPage.gotoInvoice(invoice.id);

    await page.getByRole("button", { name: "Issue voucher", exact: true }).click();
    const voucherDialog = page.getByRole("dialog", {
      name: "Issue voucher: INV-E2E-0001",
      exact: true,
    });
    await voucherDialog.getByRole("button", { name: "Issue voucher", exact: true }).click();
    await expect(
      page.getByRole("table", { name: "Vouchers issued for this invoice" }),
    ).toContainText("1,350.00");
    expect(vouchers).toHaveLength(1);

    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Record payment: INV-E2E-0001",
      exact: true,
    });
    await dialog.getByLabel("Amount", { exact: true }).fill("500.00");
    await dialog.getByRole("button", { name: "Record payment", exact: true }).click();
    await expect(dialog.getByText(/Payment of 500.00 recorded/)).toBeVisible();
    expect(payments).toHaveLength(1);
  });
});

test.describe("the payments page, as finance staff", () => {
  test.use({
    authUser: buildUser({
      roles: [buildRole({ slug: "finance_staff", name: "Finance staff" })],
      permissions: FEES_PAYMENTS_STAFF_PERMISSIONS,
    }),
  });

  test("is never offered the approval or the payout on the Refunds tab", async ({
    mockApi,
    feePaymentsPage,
    signedIn: _signedIn,
  }) => {
    stubPaymentsApi(mockApi, {
      refunds: [buildFeeRefund({ amount: "200.00", requested_by: someoneElse })],
      actorId: someoneElse,
    });
    await feePaymentsPage.gotoTab("refunds");

    await expect(feePaymentsPage.row("refunds", "Charged twice")).toBeVisible();
    await expect(feePaymentsPage.button(/Approve the refund/)).toHaveCount(0);
    await expect(feePaymentsPage.button(/Process the refund/)).toHaveCount(0);
  });
});
