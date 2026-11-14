import { readFile } from "node:fs/promises";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { financeStaffSession } from "@/lib/live-fees";
import { billedInvoice, SETUP_MARGIN_MS } from "@/lib/live-fees-scope";
import { LIVE_JOB_TIMEOUT_MS } from "@/lib/live-jobs";
import { E2E_FINANCE_STAFF_EMAIL } from "@/lib/seed-constants";

/**
 * Live lane — requires the real stack, seeded (`seed_e2e_data`; see
 * `tests/live/tenant-isolation.spec.ts`'s header for the run command).
 *
 * fees-finance.md §7 as the cashier meets it: the seeded `finance_staff` signs in, opens Fees &
 * Finance, then Counter, finds the student a run-unique invoice was raised for, records a payment
 * against it and prints the receipt. What only the browser proves: that the student picker finds
 * the student under the real record scope, that the invoice list and balance the counter shows
 * are the server's, that the payment the dialog builds is one the server accepts (with its
 * `Idempotency-Key`), that the receipt id the response carries names a receipt that streams, and
 * that what the browser saves is a real PDF (WeasyPrint). The refusals the counter shows inline,
 * the idempotent replay and the receipt in both layouts are the API lane's
 * (`api/fees-collection.spec.ts`).
 *
 * Auth budget (`AuthEndpointThrottle`, e2e/AGENTS.md): **one** browser login and **no** refresh.
 * Every screen after it is reached by a click (sidebar, then the picker), never `page.goto`. The
 * run-unique invoice is built over HTTP through the worker's cached sessions (the accountant, who
 * owns the structure, and the finance staff session that bills and reads it back), so the
 * journey adds no browser login beyond its own.
 *
 * Waits: the generation job is awaited over the API (up to `LIVE_JOB_TIMEOUT_MS`) before the
 * browser opens, so the test's budget is that plus the setup margin, not the project's 30 s.
 * Once the browser opens nothing polls: recording is synchronous and the receipt streams, so the
 * default 5 s expect covers every step (L6).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("fee counter (real API, finance staff)", () => {
  test("the cashier records a payment at the counter and a receipt PDF downloads", async ({
    page,
    loginPage,
    dashboardPage,
    feeCounterPage,
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const { scope, invoice } = await billedInvoice(liveApiClient, counter);

    // --- 1. Sign in and reach the counter through the sidebar. ---
    await loginPage.goto();
    await loginPage.signIn({
      identifier: E2E_FINANCE_STAFF_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");
    // The permission-gated nav renders only after the dashboard's own data loads.
    await expect(dashboardPage.heading).toBeVisible();
    await dashboardPage.navGroup("Fees & Finance").click();
    await dashboardPage.navLink("Counter").click();
    await expect(page).toHaveURL(/\/fees\/counter$/);

    // --- 2. The student's outstanding invoice, with the server's balance. ---
    await feeCounterPage.pickStudent(scope.studentName, scope.studentName);
    await expect(feeCounterPage.row(invoice.invoice_no)).toBeVisible();
    await expect(feeCounterPage.row(invoice.invoice_no)).toContainText(
      Number(invoice.balance_due).toLocaleString("en-US", { minimumFractionDigits: 2 }),
    );

    // --- 3. Record the whole balance in cash. ---
    await feeCounterPage.recordButton(invoice.invoice_no).click();
    const dialog = feeCounterPage.dialog(invoice.invoice_no);
    await expect(feeCounterPage.amount(dialog)).toHaveValue(invoice.balance_due);
    await feeCounterPage.submit(dialog).click();
    await expect(dialog.getByText(/Payment of .* recorded\. Receipt RCP-/)).toBeVisible();

    // --- 4. Print the receipt: the browser saves a real PDF. ---
    const download = page.waitForEvent("download");
    await feeCounterPage.printButton(dialog, "PDF").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^RCP-.+-pdf\.pdf$/);
    const path = await file.path();
    expect((await readFile(path)).subarray(0, 5).toString()).toBe("%PDF-");

    // The list reloaded behind the dialog: the invoice is settled, so nothing is left to take.
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(feeCounterPage.row(invoice.invoice_no)).toHaveCount(0);
  });
});
