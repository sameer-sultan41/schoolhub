import { expect, test } from "@/fixtures";
import { buildRole, buildUser, FEES_INVOICING_PERMISSIONS, ORG_IDS, uuid } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildAcademicSession,
  buildFeeHead,
  buildFeeInvoice,
  buildFeeSchedule,
  buildFeeStructure,
  buildLedgerAccount,
  buildSchoolClass,
  feesInvoicingModule,
  feesSetupModule,
  type FeeInvoice,
  type FeesInvoicingOptions,
  jobsModule,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * Fee invoicing (PR B) against a stubbed API: `/fees/invoices` (the list with its Defaulters
 * switch), the Generate invoices dialog (a 202 job and its created and skipped counts), an
 * invoice's page and Cancel. The stub (`feesInvoicingModule`) enforces the server's rules the
 * screens surface (L5): `:generate` skips whoever is already billed for the period, `:cancel`
 * is refused once money is paid, and `outstanding` means a balance owing on an invoice not
 * canceled. Whether the server really does is the live lane's
 * (`tests/live/api/fees-invoicing.spec.ts`).
 */

const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const income = buildLedgerAccount({ code: "4001", name: "Tuition income" });
const head = buildFeeHead({ code: "TUI", name: "Tuition fee", ledger_account: income.id });
const structure = buildFeeStructure({
  name: "Grade 1 fees 2026",
  academic_session: session.id,
  school_class: grade1.id,
  status: "active",
  schedules: [buildFeeSchedule({ fee_head: head.id, amount: "1500.00" })],
});
const ayesha = { id: uuid(), name: "Ayesha Khan" };
const bilal = { id: uuid(), name: "Bilal Ahmed" };

// The seeded `accountant`'s keys for these screens, no wider (L55).
const accountant = buildUser({
  roles: [buildRole({ slug: "accountant", name: "Accountant" })],
  permissions: FEES_INVOICING_PERMISSIONS,
});
// `finance_staff` raises and generates invoices but cannot cancel one (`fees.invoice.update`).
const financeStaff = buildUser({
  roles: [buildRole({ slug: "finance_staff", name: "Finance staff" })],
  permissions: FEES_INVOICING_PERMISSIONS.filter((key) => key !== "fees.invoice.update"),
});

const GENERATE_PATH = /\/fee-invoices:generate$/;
const CANCEL_PATH = /\/fee-invoices\/[^/]+:cancel$/;

function stubInvoicingApi(mockApi: MockApi, invoices: FeeInvoice[] = []) {
  const jobs: NonNullable<FeesInvoicingOptions["jobs"]> = {};
  mockApi.use(
    schoolOrganizationModule({ academicSessions: [session], classes: [grade1] }),
    feesSetupModule({ accounts: [income], heads: [head], structures: [structure] }),
    feesInvoicingModule({
      invoices,
      structures: [structure],
      students: [ayesha, bilal],
      jobs,
    }),
    jobsModule({ jobs }),
  );
  return invoices;
}

function unpaid(overrides: Partial<FeeInvoice> = {}): FeeInvoice {
  return buildFeeInvoice({
    student: ayesha.id,
    student_name: ayesha.name,
    academic_session: session.id,
    fee_structure: structure.id,
    period_label: "2026-09",
    subtotal: "1500.00",
    balance_due: "1500.00",
    ...overrides,
  });
}

test.describe("the accountant", () => {
  test.use({ authUser: accountant });

  test("generates a month's invoices, re-runs to skip them, then opens one and cancels it", async ({
    page,
    mockApi,
    feeInvoicesPage,
    signedIn: _signedIn,
  }) => {
    stubInvoicingApi(mockApi);
    await feeInvoicesPage.goto();
    await expect(feeInvoicesPage.table).toBeVisible();

    // The first run bills both students; the counts are the job's own.
    await feeInvoicesPage.generateButton.click();
    await feeInvoicesPage.structureSelect.click();
    await feeInvoicesPage.option("Grade 1 fees 2026").click();
    await feeInvoicesPage.monthInput.fill("2026-10");
    const firstRun = page.waitForRequest((r) => isApiCall(r, "POST", GENERATE_PATH));
    await feeInvoicesPage.submitGenerate.click();
    const request = await firstRun;
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON()).toEqual({
      fee_structure: structure.id,
      period_start: "2026-10-01",
    });
    await expect(feeInvoicesPage.generateDialog.getByText("2 invoices created")).toBeVisible();
    await expect(feeInvoicesPage.generateDialog.getByText(/0 students skipped/)).toBeVisible();

    // The list reloaded behind the dialog: one row per student, the structure's amount.
    await feeInvoicesPage.closeGenerateButton.click();
    await expect(feeInvoicesPage.row(ayesha.name)).toContainText("1,500.00");
    await expect(feeInvoicesPage.row(bilal.name)).toContainText("Grade 1 fees 2026");

    // The same month again bills nobody: a success that says so, not an error.
    await feeInvoicesPage.generateButton.click();
    await feeInvoicesPage.structureSelect.click();
    await feeInvoicesPage.option("Grade 1 fees 2026").click();
    await feeInvoicesPage.monthInput.fill("2026-10");
    await feeInvoicesPage.submitGenerate.click();
    await expect(
      feeInvoicesPage.generateDialog.getByText(
        "Nothing new to bill: everyone was already billed for this period.",
      ),
    ).toBeVisible();
    await expect(feeInvoicesPage.generateDialog.getByText(/2 students skipped/)).toBeVisible();
    await feeInvoicesPage.closeGenerateButton.click();
    await expect(feeInvoicesPage.table.getByRole("row")).toHaveCount(3);

    // Open Ayesha's invoice: its lines and the server's totals.
    await feeInvoicesPage.row(ayesha.name).getByRole("link").click();
    await expect(page).toHaveURL(/\/fees\/invoices\/[0-9a-f-]{36}$/);
    await expect(feeInvoicesPage.linesTable.getByText("Tuition fee")).toBeVisible();
    await expect(feeInvoicesPage.totalRow("Balance due")).toContainText("1,500.00");

    // Cancel needs a reason; the invoice reloads as canceled and offers no second Cancel.
    await feeInvoicesPage.cancelButton.click();
    const dialog = feeInvoicesPage.dialog(/^Cancel invoice INV-E2E-/);
    await dialog.getByRole("button", { name: "Cancel invoice", exact: true }).click();
    await expect(dialog.getByText("This field is required.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Raised in error");
    const cancel = page.waitForRequest((r) => isApiCall(r, "POST", CANCEL_PATH));
    await dialog.getByRole("button", { name: "Cancel invoice", exact: true }).click();
    expect((await cancel).postDataJSON()).toEqual({ reason: "Raised in error" });
    await expect(page.getByText("Canceled: Raised in error")).toBeVisible();
    await expect(feeInvoicesPage.cancelButton).toHaveCount(0);
  });

  test("lists only the invoices still owing money under Defaulters", async ({
    page,
    mockApi,
    feeInvoicesPage,
    signedIn: _signedIn,
  }) => {
    stubInvoicingApi(mockApi, [
      unpaid({ invoice_no: "INV-E2E-0001" }),
      unpaid({
        invoice_no: "INV-E2E-0002",
        student: bilal.id,
        student_name: bilal.name,
        status: "paid",
        paid_total: "1500.00",
        balance_due: "0.00",
      }),
    ]);
    await feeInvoicesPage.goto();
    await expect(feeInvoicesPage.row("INV-E2E-0002")).toBeVisible();

    await feeInvoicesPage.defaultersSwitch.click();

    await expect(page).toHaveURL(/outstanding=true/);
    await expect(feeInvoicesPage.row("INV-E2E-0001")).toBeVisible();
    await expect(feeInvoicesPage.row("INV-E2E-0002")).toHaveCount(0);
  });

  test("is refused cancelling an invoice that was paid after the page loaded", async ({
    mockApi,
    feeInvoicesPage,
    signedIn: _signedIn,
  }) => {
    const [invoice] = stubInvoicingApi(mockApi, [unpaid()]);
    if (!invoice) throw new Error("the seeded invoice is missing");
    await feeInvoicesPage.gotoInvoice(invoice.id);
    await expect(feeInvoicesPage.cancelButton).toBeVisible();

    // A payment lands elsewhere while the page is open: the server refuses, the dialog says why.
    invoice.paid_total = "500.00";
    await feeInvoicesPage.cancelButton.click();
    const dialog = feeInvoicesPage.dialog(/^Cancel invoice INV-E2E-/);
    await dialog.getByLabel("Reason").fill("Raised in error");
    await dialog.getByRole("button", { name: "Cancel invoice", exact: true }).click();
    await expect(
      dialog.getByText(
        "500.00 has been paid against this invoice. Refund the payment rather than cancelling the charge.",
      ),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe("finance staff", () => {
  test.use({ authUser: financeStaff });

  test("raise and generate invoices but are offered no Cancel", async ({
    mockApi,
    feeInvoicesPage,
    signedIn: _signedIn,
  }) => {
    const [invoice] = stubInvoicingApi(mockApi, [unpaid()]);
    if (!invoice) throw new Error("the seeded invoice is missing");
    await feeInvoicesPage.goto();
    await expect(feeInvoicesPage.generateButton).toBeVisible();
    await expect(feeInvoicesPage.createButton).toBeVisible();

    await feeInvoicesPage.gotoInvoice(invoice.id);
    await expect(feeInvoicesPage.linesTable).toBeVisible();
    await expect(feeInvoicesPage.cancelButton).toHaveCount(0);
  });
});
