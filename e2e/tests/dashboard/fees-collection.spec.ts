import { expect, test } from "@/fixtures";
import {
  buildRole,
  buildUser,
  FEES_COUNTER_PERMISSIONS,
  FEES_INVOICING_PERMISSIONS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildFeeInvoice,
  buildStudent,
  feesCollectionModule,
  feesInvoicingModule,
  type FeeInvoice,
  type FeePayment,
  type FeesCollectionOptions,
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

    await expect(page.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Counter" })).toHaveCount(0);
  });
});
