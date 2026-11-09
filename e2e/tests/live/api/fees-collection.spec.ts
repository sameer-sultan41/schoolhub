import { randomUUID } from "node:crypto";
import type { ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import { accountantSession, financeStaffSession, refusal } from "@/lib/live-fees";
import { activeStructure, enrolledStudentScope, generate } from "@/lib/live-fees-scope";
import { awaitJobResult, LIVE_JOB_TIMEOUT_MS } from "@/lib/live-jobs";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * The fee counter (PR C) against the real API: the structure is the accountant's to build
 * (`fees.fee-structure.*`), and everything at the counter is the seeded `finance_staff`'s, so the
 * real role's keys are what is exercised (`fees.invoice.view|create`, `fees.payment.collect|view`).
 * It runs on a run-unique session, class and student that no other spec or worker shares. Field
 * validation stays in the Django suite (`apps/api/apps/fees_finance/tests/`); this lane pins what
 * only a real stack shows: the idempotent replay through the real key store, the server's own
 * balance arithmetic, the refusals the counter shows inline, a receipt that really renders as a
 * PDF in both layouts (WeasyPrint), and RLS.
 *
 * Endpoints covered: `POST /fee-structures`, `POST /fee-schedules`,
 * `POST /fee-structures/{id}:activate`, `POST /fee-invoices:generate`, `GET /jobs/{id}`,
 * `GET /fee-invoices`, `POST /payments:record`, `GET /payments`,
 * `GET /receipts/{id}/download`.
 */

interface Invoice {
  id: string;
  status: string;
  subtotal: string;
  paid_total: string;
  balance_due: string;
}

interface Payment {
  id: string;
  fee_invoice: string;
  amount: string;
  method: string;
  status: string;
  receipt: string | null;
  receipt_no: string;
}

interface GenerationResult {
  issued: number;
  skipped: number;
}

/** One polled job, two cold logins and the scope's dozen writes (L6). */
const SETUP_MARGIN_MS = 60_000;
const PART_PAYMENT = "500.00";

/** A run-unique student billed once: the invoice the counter takes money against. */
async function billedInvoice(liveApiClient: ApiClient, counter: ApiClient) {
  const accountant = await accountantSession();
  const scope = await enrolledStudentScope(liveApiClient);
  const structureId = await activeStructure(accountant, scope);
  const jobId = await generate(counter, {
    fee_structure: structureId,
    period_start: scope.periodStart,
  });
  const result = await awaitJobResult<GenerationResult>(counter, jobId);
  expect(result).toMatchObject({ issued: 1, skipped: 0 });
  const listed = await counter.get<Invoice[]>("/fee-invoices", {
    query: { student: scope.studentId },
  });
  const [invoice] = listed.data as [Invoice];
  return { scope, invoice };
}

function record(
  counter: ApiClient,
  body: { fee_invoice: string; amount: string; method: string; reference_no?: string },
  idempotencyKey = randomUUID(),
) {
  return counter.post<Payment>("/payments:record", body, { idempotencyKey });
}

function fieldsOf(error: { details: { field: string }[] }) {
  return error.details.map((detail) => detail.field);
}

test.describe("fee counter (live API)", () => {
  test("a payment recorded twice with one key is one payment, and its receipt renders as a PDF", async ({
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const { scope, invoice } = await billedInvoice(liveApiClient, counter);
    expect(Number(invoice.subtotal)).toBeGreaterThan(Number(PART_PAYMENT));
    const body = { fee_invoice: invoice.id, amount: PART_PAYMENT, method: "cash" };

    // The same key replays the first answer: one payment, not two.
    const key = randomUUID();
    const first = await record(counter, body, key);
    const again = await record(counter, body, key);
    expect(first.status).toBe(201);
    expect(again.data.id).toBe(first.data.id);
    const payments = await counter.get<Payment[]>("/payments", { query: { invoice: invoice.id } });
    expect(payments.data.map((row) => row.id)).toEqual([first.data.id]);
    expect(first.data).toMatchObject({ amount: PART_PAYMENT, status: "confirmed", method: "cash" });

    // The server's own arithmetic: nothing is summed client-side.
    const after = (await counter.get<Invoice>(`/fee-invoices/${invoice.id}`)).data;
    expect(after.paid_total).toBe(PART_PAYMENT);
    expect(Number(after.balance_due)).toBe(Number(invoice.subtotal) - Number(PART_PAYMENT));
    expect(after.status).toBe("partially_paid");

    // The payment names its receipt, which renders as a PDF in both layouts.
    expect(first.data.receipt).toBeTruthy();
    for (const format of ["pdf", "thermal"] as const) {
      const blob = await counter.downloadBlob(`/receipts/${first.data.receipt}/download`, {
        query: { format },
      });
      expect(await blob.slice(0, 5).text()).toBe("%PDF-");
    }

    // The same key with another body is refused, not replayed as if it had run.
    const reused = await refusal(record(counter, { ...body, amount: "100.00" }, key));
    expect(reused.status).toBe(422);
    expect(
      (await counter.get<Payment[]>("/payments", { query: { invoice: invoice.id } })).data,
    ).toHaveLength(1);

    // Paying the rest settles the invoice and takes it off the defaulter list.
    const outstanding = await counter.get<Invoice[]>("/fee-invoices", {
      query: { student: scope.studentId, outstanding: true },
    });
    expect(outstanding.data.map((row) => row.id)).toEqual([invoice.id]);
    await record(counter, { ...body, amount: after.balance_due });
    const settled = (await counter.get<Invoice>(`/fee-invoices/${invoice.id}`)).data;
    expect(settled).toMatchObject({ status: "paid", balance_due: "0.00" });
    const none = await counter.get<Invoice[]>("/fee-invoices", {
      query: { student: scope.studentId, outstanding: true },
    });
    expect(none.data).toHaveLength(0);
  });

  test("the counter's refusals name the field: over the balance, a missing reference, the gateway", async ({
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const { invoice } = await billedInvoice(liveApiClient, counter);
    const overBalance = (Number(invoice.balance_due) + 1).toFixed(2);

    const over = await refusal(
      record(counter, { fee_invoice: invoice.id, amount: overBalance, method: "cash" }),
    );
    expect(over.status).toBe(422);
    expect(fieldsOf(over)).toContain("amount");

    const noReference = await refusal(
      record(counter, { fee_invoice: invoice.id, amount: PART_PAYMENT, method: "cheque" }),
    );
    expect(noReference.status).toBe(400);
    expect(fieldsOf(noReference)).toContain("reference_no");

    const gateway = await refusal(
      record(counter, { fee_invoice: invoice.id, amount: PART_PAYMENT, method: "online_gateway" }),
    );
    expect(gateway.status).toBe(400);
    expect(fieldsOf(gateway)).toContain("method");

    const zero = await refusal(
      record(counter, { fee_invoice: invoice.id, amount: "0.00", method: "cash" }),
    );
    expect(fieldsOf(zero)).toContain("amount");

    // None of the refusals took any money.
    const payments = await counter.get<Payment[]>("/payments", { query: { invoice: invoice.id } });
    expect(payments.data).toHaveLength(0);
  });

  test("a canceled invoice takes no payment", async ({ liveApiClient }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const accountant = await accountantSession();
    const { invoice } = await billedInvoice(liveApiClient, counter);
    await accountant.post(`/fee-invoices/${invoice.id}:cancel`, { reason: "E2E cancel" });

    const refused = await refusal(
      record(counter, { fee_invoice: invoice.id, amount: PART_PAYMENT, method: "cash" }),
    );

    expect(refused.status).toBe(422);
    expect(fieldsOf(refused)).toContain("fee_invoice");
  });

  test("another tenant's invoice and receipt are a 404, never a 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const { scope, invoice } = await billedInvoice(liveApiClient, counter);
    const payment = (
      await record(counter, { fee_invoice: invoice.id, amount: PART_PAYMENT, method: "cash" })
    ).data;

    // A real row and a real second identity: a 403 would confirm the row exists elsewhere.
    const recordElsewhere = await refusal(
      record(liveOtherTenantApiClient, {
        fee_invoice: invoice.id,
        amount: PART_PAYMENT,
        method: "cash",
      }),
    );
    expect(recordElsewhere.status).toBe(404);
    const download = await refusal(
      liveOtherTenantApiClient.downloadBlob(`/receipts/${payment.receipt}/download`),
    );
    expect(download.status).toBe(404);
    const others = await liveOtherTenantApiClient.get<Payment[]>("/payments", {
      query: { student: scope.studentId },
    });
    expect(others.data).toHaveLength(0);
  });
});
