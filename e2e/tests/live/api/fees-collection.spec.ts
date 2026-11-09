import { randomUUID } from "node:crypto";
import type { ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import {
  accountantApproverSession,
  accountantSession,
  financeStaffSession,
  refusal,
} from "@/lib/live-fees";
import { billedInvoice, type LiveInvoice as Invoice, SETUP_MARGIN_MS } from "@/lib/live-fees-scope";
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
 * The Payments page's writes (task C3) are in the same file: refunds (request, the requester's own
 * approval refused, the second accountant's approval, process), vouchers (issue, void, the paid
 * one refused) and the settlement upload (multipart, 202 + job, exceptions).
 *
 * Endpoints covered: `POST /fee-structures`, `POST /fee-schedules`,
 * `POST /fee-structures/{id}:activate`, `POST /fee-invoices:generate`, `GET /jobs/{id}`,
 * `GET /fee-invoices`, `POST /payments:record`, `GET /payments`,
 * `GET /receipts/{id}/download`, `POST /refunds:create`, `GET /refunds`,
 * `POST /refunds/{id}:approve|:process`, `POST /fee-invoices/{id}/vouchers`,
 * `POST /vouchers/{id}:void`, `GET /vouchers/{id}/download`,
 * `POST /voucher-collection-imports`, `GET /voucher-collection-imports`.
 */

interface Payment {
  id: string;
  fee_invoice: string;
  amount: string;
  method: string;
  status: string;
  receipt: string | null;
  receipt_no: string;
}

interface Refund {
  id: string;
  status: string;
  amount: string;
  decision_note: string | null;
  method: string | null;
}

interface Voucher {
  id: string;
  status: string;
  provider: string;
  amount: string;
  consumer_number: string;
  voided_reason: string | null;
}

const PART_PAYMENT = "500.00";

function record(
  counter: ApiClient,
  body: { fee_invoice: string; amount: string; method: string; reference_no?: string },
  idempotencyKey = randomUUID(),
) {
  return counter.post<Payment>("/payments:record", body, { idempotencyKey });
}

function fieldsOf(error: { details: { field?: string }[] }) {
  return error.details.flatMap((detail) => (detail.field === undefined ? [] : [detail.field]));
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

  test("refunds: bounded by the remainder, the requester cannot approve, the second accountant can, and process pays out once", async ({
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const accountant = await accountantSession();
    const approver = await accountantApproverSession();
    const { invoice } = await billedInvoice(liveApiClient, counter);
    const payment = (
      await record(counter, { fee_invoice: invoice.id, amount: PART_PAYMENT, method: "cash" })
    ).data;
    const request = (amount: string, key = randomUUID()) =>
      accountant.post<Refund>(
        "/refunds:create",
        { payment: payment.id, amount, reason: "E2E charged twice" },
        { idempotencyKey: key },
      );

    // More than the payment is refused under `amount`, with what is left in `meta`.
    const over = await refusal(request("600.00"));
    expect(over.status).toBe(422);
    expect(fieldsOf(over)).toContain("amount");
    expect(over.meta["refundable_remainder"]).toBe(PART_PAYMENT);

    // The request replays under its key: one refund, not two.
    const key = randomUUID();
    const filed = await request("200.00", key);
    const again = await request("200.00", key);
    expect(filed.status).toBe(201);
    expect(again.data.id).toBe(filed.data.id);
    expect(filed.data).toMatchObject({ status: "requested", amount: "200.00" });
    const listed = await accountant.get<Refund[]>("/refunds", { query: { payment: payment.id } });
    expect(listed.data.map((row) => row.id)).toEqual([filed.data.id]);

    // What it asked for counts against the payment: 300.00 is left, so 400.00 is refused.
    const second = await refusal(request("400.00"));
    expect(second.status).toBe(422);
    expect(second.meta["refundable_remainder"]).toBe("300.00");

    // Segregation of duties: the requester cannot approve, and finance staff hold no approval key.
    const self = await refusal(accountant.post(`/refunds/${filed.data.id}:approve`, {}));
    expect(self.status).toBe(422);
    expect(fieldsOf(self)).toContain("approved_by");
    const staff = await refusal(counter.post(`/refunds/${filed.data.id}:approve`, {}));
    expect(staff.status).toBe(403);

    // Processing before approval is refused; the second accountant approves.
    const early = await refusal(
      approver.post(
        `/refunds/${filed.data.id}:process`,
        { method: "cash" },
        { idempotencyKey: randomUUID() },
      ),
    );
    expect(early.status).toBe(422);
    const approved = await approver.post<Refund>(`/refunds/${filed.data.id}:approve`, {
      note: "Verified",
    });
    expect(approved.data).toMatchObject({ status: "approved", decision_note: "Verified" });
    const decidedAgain = await refusal(approver.post(`/refunds/${filed.data.id}:reject`, {}));
    expect(decidedAgain.status).toBe(422);

    // Process pays it out once: the same key replays, the same key with another body is refused.
    const processKey = randomUUID();
    const body = { method: "cash", reference_no: "E2E-REF" };
    const processed = await approver.post<Refund>(`/refunds/${filed.data.id}:process`, body, {
      idempotencyKey: processKey,
    });
    const replayed = await approver.post<Refund>(`/refunds/${filed.data.id}:process`, body, {
      idempotencyKey: processKey,
    });
    expect(processed.data).toMatchObject({ status: "processed", method: "cash" });
    expect(replayed.data.id).toBe(processed.data.id);
    const reused = await refusal(
      approver.post(
        `/refunds/${filed.data.id}:process`,
        { method: "card" },
        { idempotencyKey: processKey },
      ),
    );
    expect(reused.status).toBe(422);
  });

  test("vouchers: issue, download, void with a reason, and none on a canceled invoice", async ({
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const accountant = await accountantSession();
    const { invoice } = await billedInvoice(liveApiClient, counter);

    const issued = await counter.post<Voucher>(`/fee-invoices/${invoice.id}/vouchers`, {
      provider: "bank_branch",
    });
    expect(issued.status).toBe(201);
    // The amount is the invoice's balance, which the server owns.
    expect(issued.data).toMatchObject({
      status: "issued",
      provider: "bank_branch",
      amount: invoice.balance_due,
    });
    for (const format of ["pdf", "thermal"] as const) {
      const blob = await counter.downloadBlob(`/vouchers/${issued.data.id}/download`, {
        query: { format },
      });
      expect(await blob.slice(0, 5).text()).toBe("%PDF-");
    }

    // A void needs its reason; with one the voucher is void.
    const blank = await refusal(counter.post(`/vouchers/${issued.data.id}:void`, { reason: "" }));
    expect(fieldsOf(blank)).toContain("reason");
    const voided = await counter.post<Voucher>(`/vouchers/${issued.data.id}:void`, {
      reason: "E2E printed for the wrong family",
    });
    expect(voided.data).toMatchObject({
      status: "void",
      voided_reason: "E2E printed for the wrong family",
    });

    // A canceled invoice takes no voucher.
    await accountant.post(`/fee-invoices/${invoice.id}:cancel`, { reason: "E2E cancel" });
    const canceled = await refusal(
      counter.post(`/fee-invoices/${invoice.id}/vouchers`, { provider: "bank_branch" }),
    );
    expect(canceled.status).toBe(422);
    expect(fieldsOf(canceled)).toContain("fee_invoice");
  });

  test("settlement upload: a matching row posts the voucher, an unknown one is an exception, and a paid voucher cannot be voided", async ({
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const { invoice } = await billedInvoice(liveApiClient, counter);
    const voucher = (
      await counter.post<Voucher>(`/fee-invoices/${invoice.id}/vouchers`, { provider: "easypaisa" })
    ).data;
    const unknown = `9${String(Date.now())}`;
    const csv = [
      "consumer_number,transaction_reference,amount,paid_on",
      `${voucher.consumer_number},E2E-TXN-${randomUUID().slice(0, 8)},${voucher.amount},2026-10-06`,
      `${unknown},E2E-TXN-X,900.00,2026-10-06`,
    ].join("\n");
    const upload = (key: string, content = csv, provider = "easypaisa") => {
      const body = new FormData();
      body.append("file", new File([content], "settlement.csv", { type: "text/csv" }));
      body.append("provider", provider);
      return counter.post<{ job_id: string }>("/voucher-collection-imports", body, {
        idempotencyKey: key,
      });
    };

    // No file and an unknown provider are refused before a job exists.
    const noFile = new FormData();
    noFile.append("provider", "easypaisa");
    const missing = await refusal(counter.post("/voucher-collection-imports", noFile));
    expect(fieldsOf(missing)).toContain("file");
    const stranger = await refusal(upload(randomUUID(), csv, "paypal"));
    expect(fieldsOf(stranger)).toContain("provider");

    const key = randomUUID();
    const accepted = await upload(key);
    expect(accepted.status).toBe(202);
    const result = await awaitJobResult<{ row_count: number; matched: number; exceptions: number }>(
      counter,
      accepted.data.job_id,
    );
    expect(result).toEqual({ row_count: 2, matched: 1, exceptions: 1 });

    // The same upload under the same key replays the first job; another file under it is refused.
    const replayed = await upload(key);
    expect(replayed.data.job_id).toBe(accepted.data.job_id);
    const reused = await refusal(upload(key, `${csv}\n`));
    expect(reused.status).toBe(422);

    // The matched row paid the voucher and settled the invoice by the server's own sums.
    const paid = (await counter.get<Voucher>(`/vouchers/${voucher.id}`)).data;
    expect(paid.status).toBe("paid");
    const settled = (await counter.get<Invoice>(`/fee-invoices/${invoice.id}`)).data;
    expect(settled).toMatchObject({ status: "paid", balance_due: "0.00" });

    // The import lists its exception with the server's reason; a paid voucher cannot be voided.
    const imports = await counter.get<
      { id: string; matched_count: number; exceptions: { reason: string }[] }[]
    >("/voucher-collection-imports", { query: { provider: "easypaisa" } });
    const mine = imports.data.find((row) =>
      row.exceptions.some((entry) => entry.reason.includes(unknown)),
    );
    expect(mine?.matched_count).toBe(1);
    expect(mine?.exceptions[0]?.reason).toBe(
      `No open voucher with consumer number '${unknown}' for easypaisa.`,
    );
    const voidPaid = await refusal(
      counter.post(`/vouchers/${voucher.id}:void`, { reason: "E2E too late" }),
    );
    expect(voidPaid.status).toBe(422);
    expect(fieldsOf(voidPaid)).toContain("status");
  });
});
