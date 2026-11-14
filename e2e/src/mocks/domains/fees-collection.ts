import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, ok, type MockResponse } from "../envelope";
import { cursorPageOf } from "../list";
import type { MockApi, MockModule } from "../router";
import { multipartFields } from "./attendance-mock-utils";
import {
  buildFeePayment,
  buildFeeVoucher,
  type FeeInvoice,
  type FeePayment,
  type FeeVoucher,
} from "./fees";
import type { JobStub } from "./jobs";

type Writable<T> = { -readonly [K in keyof T]: T[K] };
export type FeeRefund = Writable<ApiSchemas["Refund"]>;
export type FeeSettlementImport = Writable<ApiSchemas["VoucherCollectionImport"]>;

const STAMP = "2026-10-01T00:00:00Z";

export function buildFeeRefund(overrides: Partial<FeeRefund> = {}): FeeRefund {
  return {
    id: uuid(),
    payment: "",
    invoice_no: "INV-E2E-0001",
    student: "",
    student_name: "Ayesha Khan",
    amount: "200.00",
    reason: "Charged twice",
    status: "requested",
    requested_by: "",
    approved_by: null,
    decision_note: null,
    method: null,
    reference_no: null,
    processed_at: null,
    created_at: STAMP,
    ...overrides,
  };
}

/** What a streamed receipt carries in the stub: a PDF header is all the download needs. */
const PDF_BODY = "%PDF-1.4 e2e receipt";

/** A receipt the stub issued, so a download finds it and a spec can read what was asked for. */
export interface IssuedReceipt {
  id: string;
  receiptNo: string;
  paymentId: string;
}

export interface FeesCollectionOptions {
  /** The invoices `:record` takes money against: the array `feesInvoicingModule` serves. */
  invoices?: FeeInvoice[];
  /** Held by reference: a recorded payment is pushed here, so `GET /payments` lists it. */
  payments?: FeePayment[];
  receipts?: IssuedReceipt[];
  /** The `?format=` of each receipt download, in order. */
  downloads?: { receiptId: string; format: string | null }[];
  /** The vouchers `GET /vouchers`, issue and `:void` work on; held by reference. */
  vouchers?: FeeVoucher[];
  /** The `?format=` of each voucher download, in order. */
  voucherDownloads?: { voucherId: string; format: string | null }[];
  /** The refunds `GET /refunds` and the transitions work on; held by reference. */
  refunds?: FeeRefund[];
  /** The settlement imports a `POST /voucher-collection-imports` adds to; held by reference. */
  imports?: FeeSettlementImport[];
  /** The poll sequences `jobsModule` serves: an upload writes its job here. Pass the same object
   * to both modules. */
  jobs?: Record<string, JobStub[]>;
  /** The id of the signed-in user, whom the stub treats as the caller: a refund they requested
   * cannot be approved by them (the server compares `requested_by` with the actor). */
  actorId?: string;
}

// The server's sentences, verbatim (`services.record_payment`, `RecordPaymentSerializer`), so a
// screen that shows them shows what users see (L5).
const REQUIRED = "This field is required.";
const POSITIVE = "A payment must be for a positive amount.";
const CANCELED = (invoiceNo: string) => `${invoiceNo} is canceled and takes no payment.`;
const OVER_BALANCE = (amount: string, balance: string, invoiceNo: string) =>
  `${amount} exceeds the ${balance} outstanding on ${invoiceNo}.`;
const NEEDS_REFERENCE = (method: string) =>
  `A ${method.replace("_", " ")} payment needs its reference number to be reconcilable against a statement.`;
const GATEWAY =
  "Gateway payments are not accepted through this endpoint. The integrations layer they need does not exist yet — see §20.";
const METHODS = ["cash", "cheque", "bank_transfer", "card", "online_gateway"];

interface RecordBody {
  fee_invoice?: string;
  amount?: string;
  method?: string;
  reference_no?: string | null;
}

function invalid(field: string, issue: string): MockResponse {
  return fail(400, issue, { details: [{ field, issue }] });
}

function ruleViolation(field: string, issue: string, meta?: Record<string, unknown>): MockResponse {
  return fail(422, issue, {
    code: "domain_rule_violation",
    details: [{ field, issue }],
    ...(meta ? { meta } : {}),
  });
}

/**
 * `POST /payments:record` and the streamed `GET /receipts/{id}/download`, over the invoices and
 * payments a spec holds by reference.
 *
 * Mirrors the server's rules the counter surfaces (lesson L5), in its words:
 * - a canceled invoice takes no payment (422 under `fee_invoice`); an amount of zero or less is a
 *   422 under `amount`; an amount over `balance_due` is a 422 under `amount` (the server also
 *   sends the balance in `meta`, which the counter does not read); a cheque or transfer without a
 *   reference is a 400 under `reference_no`; the gateway method is a 400 under `method`;
 * - a success is a 201 that moves the invoice's `paid_total`, `balance_due` and status (the
 *   server's figures, not the client's) and issues a receipt;
 * - the same `Idempotency-Key` replays the first payment, and the same key with another body is
 *   a 422, as `replay_or_execute` answers.
 *
 * Whether the server really enforces any of this is the live lane's
 * (`tests/live/api/fees-collection.spec.ts`).
 */
export function feesCollectionModule(options: FeesCollectionOptions = {}): MockModule {
  return (api) => {
    const invoices = options.invoices ?? [];
    const payments = options.payments ?? [];
    const receipts = options.receipts ?? [];
    const downloads = options.downloads ?? [];
    const replays = new Map<string, { body: string; response: MockResponse }>();

    // `router.ts` reads `:name` as a param, so `/payments:record` compiles to `^/payments([^/]+)$`
    // and captures ":record" whole; it never meets `GET /payments`, which has nothing there.
    api.post("/payments:collectionAction", (request) => {
      if (request.params["collectionAction"] !== ":record") return fail(404, "Not found.");
      const body = (request.json() as RecordBody | null) ?? {};
      const key = request.headers["idempotency-key"];
      const serialized = JSON.stringify(body, Object.keys(body).sort());

      if (!body.fee_invoice) return invalid("fee_invoice", REQUIRED);
      if (body.amount === undefined) return invalid("amount", REQUIRED);
      if (!body.method) return invalid("method", REQUIRED);
      if (!METHODS.includes(body.method))
        return invalid("method", `"${body.method}" is not a valid choice.`);
      if (Number(body.amount) <= 0) return invalid("amount", POSITIVE);
      if (["cheque", "bank_transfer"].includes(body.method) && !body.reference_no) {
        return invalid("reference_no", NEEDS_REFERENCE(body.method));
      }
      if (body.method === "online_gateway") return invalid("method", GATEWAY);

      const invoice = invoices.find((row) => row.id === body.fee_invoice);
      if (!invoice) return fail(404, "Not found.");

      const replay = key ? replays.get(key) : undefined;
      if (replay) {
        return replay.body === serialized ? replay.response : keyReused();
      }

      const amount = Number(body.amount).toFixed(2);
      if (invoice.status === "canceled") {
        return ruleViolation("fee_invoice", CANCELED(invoice.invoice_no));
      }
      if (Number(amount) > Number(invoice.balance_due)) {
        return ruleViolation(
          "amount",
          OVER_BALANCE(amount, invoice.balance_due, invoice.invoice_no),
        );
      }

      const receiptId = uuid();
      const receiptNo = `RCP-E2E-${String(receipts.length + 1).padStart(4, "0")}`;
      const payment = buildFeePayment({
        fee_invoice: invoice.id,
        invoice_no: invoice.invoice_no,
        student: invoice.student,
        student_name: invoice.student_name,
        amount,
        method: body.method as FeePayment["method"],
        reference_no: body.reference_no ?? null,
        paid_at: new Date().toISOString(),
        receipt: receiptId,
        receipt_no: receiptNo,
      });
      payments.push(payment);
      receipts.push({ id: receiptId, receiptNo, paymentId: payment.id });

      // The server recomputes the invoice's money columns; the stub does the same sums.
      invoice.paid_total = (Number(invoice.paid_total) + Number(amount)).toFixed(2);
      invoice.balance_due = (Number(invoice.balance_due) - Number(amount)).toFixed(2);
      invoice.status = Number(invoice.balance_due) === 0 ? "paid" : "partially_paid";

      const response = ok(payment, { status: 201, meta: { message: "Payment recorded." } });
      if (key) replays.set(key, { body: serialized, response });
      return response;
    });

    api.get("/receipts/:receiptId/download", (request): MockResponse => {
      const receiptId = request.params["receiptId"];
      if (!receipts.some((row) => row.id === receiptId)) return fail(404, "Not found.");
      downloads.push({ receiptId: receiptId ?? "", format: request.searchParams.get("format") });
      return { status: 200, body: PDF_BODY, headers: { "content-type": "application/pdf" } };
    });

    const state: CollectionState = {
      invoices,
      payments,
      receipts,
      vouchers: options.vouchers ?? [],
      voucherDownloads: options.voucherDownloads ?? [],
      refunds: options.refunds ?? [],
      imports: options.imports ?? [],
      jobs: options.jobs ?? {},
      actorId: options.actorId ?? "",
    };
    registerReads(api, state);
    registerVoucherRoutes(api, state);
    registerRefundRoutes(api, state);
    registerSettlementRoutes(api, state);
  };
}

interface CollectionState {
  invoices: FeeInvoice[];
  payments: FeePayment[];
  receipts: IssuedReceipt[];
  vouchers: FeeVoucher[];
  voucherDownloads: { voucherId: string; format: string | null }[];
  refunds: FeeRefund[];
  imports: FeeSettlementImport[];
  jobs: Record<string, JobStub[]>;
  actorId: string;
}

// The server's sentences for the Payments page's actions, verbatim (`services.py`), so a screen
// that shows them shows what users see (L5).
const BLANK = "This field may not be blank.";
const VOID_PAID = "A paid voucher cannot be voided. Refund the payment instead.";
const VOUCHER_CANCELED = (invoiceNo: string) => `${invoiceNo} is canceled and takes no voucher.`;
const VOUCHER_SETTLED = (invoiceNo: string) =>
  `${invoiceNo} is settled; there is nothing to collect.`;
const REFUND_POSITIVE = "A refund must be for a positive amount.";
const REFUND_NOT_CONFIRMED = "Only a confirmed payment can be refunded.";
const REFUND_OVER = (amount: string, remaining: string) =>
  `${amount} exceeds the ${remaining} still refundable on this payment.`;
const REFUND_SELF = "The person who requested a refund cannot approve it (auth-and-rbac §2.4).";
const REFUND_DECIDED = (status: string) => `This refund is already ${status}.`;
const REFUND_NOT_APPROVED = "Only an approved refund can be processed.";
const IMPORT_NO_FILE = "A settlement file is required.";
const PROVIDERS = ["bank_branch", "easypaisa", "jazzcash"];
const IMPORT_UNKNOWN_PROVIDER = `Unknown provider. Expected one of: ${PROVIDERS.join(", ")}.`;
const KEY_REUSED =
  "This Idempotency-Key was already used with a different request. Use a new key for a new request.";

/** `IdempotencyKeyReused`: code `idempotency_key_reused`, and a string detail flattens to the
 * field `non_field` (`_flatten_details` in `core/api/exceptions.py`). */
function keyReused(): MockResponse {
  return fail(422, KEY_REUSED, {
    code: "idempotency_key_reused",
    details: [{ field: "non_field", issue: KEY_REUSED }],
  });
}

/** One idempotent write: the same key and body replays the first answer, the same key with
 * another body is the server's 422, as `replay_or_execute` answers. */
function idempotentWrite(
  replays: Map<string, { body: string; response: MockResponse }>,
  key: string | undefined,
  body: unknown,
  execute: () => MockResponse,
): MockResponse {
  const serialized = JSON.stringify(body);
  const replay = key ? replays.get(key) : undefined;
  if (replay) {
    return replay.body === serialized ? replay.response : keyReused();
  }
  const response = execute();
  // The server stores only successes: a refusal leaves the key free for a corrected request.
  if (key && response.status < 400) replays.set(key, { body: serialized, response });
  return response;
}

const money = (value: number) => value.toFixed(2);
const PDF_VOUCHER_BODY = "%PDF-1.4 e2e voucher";

/** The Payments page's reads: payments (every filter), receipts, vouchers, refunds. They replace
 * `feesInvoicingModule`'s narrower `/payments` and `/vouchers` where both modules are used. */
function registerReads(api: MockApi, state: CollectionState) {
  api.get("/payments", (request) => {
    const params = request.searchParams;
    const matching = state.payments.filter(
      (payment) =>
        (!params.get("invoice") || payment.fee_invoice === params.get("invoice")) &&
        (!params.get("student") || payment.student === params.get("student")) &&
        (!params.get("method") || payment.method === params.get("method")) &&
        (!params.get("status") || payment.status === params.get("status")) &&
        (!params.get("received_by") || payment.received_by === params.get("received_by")) &&
        (!params.get("paid_at__gte") ||
          (payment.paid_at ?? "") >= new Date(params.get("paid_at__gte") ?? "").toISOString()) &&
        (!params.get("paid_at__lt") ||
          (payment.paid_at ?? "") < new Date(params.get("paid_at__lt") ?? "").toISOString()),
    );
    return cursorPageOf(matching, params);
  });

  api.get("/receipts", (request) => {
    const params = request.searchParams;
    const search = params.get("search")?.toLowerCase();
    const matching = state.receipts
      .filter((receipt) => !search || receipt.receiptNo.toLowerCase().includes(search))
      .map((receipt) => {
        const payment = state.payments.find((row) => row.id === receipt.paymentId);
        const invoice = state.invoices.find((row) => row.id === payment?.fee_invoice);
        return {
          id: receipt.id,
          receipt_no: receipt.receiptNo,
          payment: receipt.paymentId,
          invoice_no: invoice?.invoice_no ?? "",
          student_name: invoice?.student_name ?? "",
          amount: payment?.amount ?? "0.00",
          issued_at: payment?.paid_at ?? STAMP,
          pdf_file: null,
        };
      });
    return cursorPageOf(matching, params);
  });

  api.get("/vouchers", (request) => {
    const params = request.searchParams;
    const matching = state.vouchers.filter(
      (voucher) =>
        (!params.get("invoice") || voucher.fee_invoice === params.get("invoice")) &&
        (!params.get("status") || voucher.status === params.get("status")) &&
        (!params.get("provider") || voucher.provider === params.get("provider")),
    );
    return cursorPageOf(matching, params);
  });

  api.get("/refunds", (request) => {
    const params = request.searchParams;
    const matching = state.refunds.filter(
      (refund) =>
        (!params.get("status") || refund.status === params.get("status")) &&
        (!params.get("payment") || refund.payment === params.get("payment")),
    );
    return cursorPageOf(matching, params);
  });
}

/**
 * Voucher issue (`POST /fee-invoices/{id}/vouchers`), `:void` and the streamed download. A
 * canceled or settled invoice takes no voucher (422 under `fee_invoice`); a paid voucher cannot
 * be voided (422 under `status`) and a void needs its reason (400).
 */
function registerVoucherRoutes(api: MockApi, state: CollectionState) {
  api.post("/fee-invoices/:invoiceId/vouchers", (request) => {
    const body = (request.json() as { provider?: string; validity_days?: number } | null) ?? {};
    if (!body.provider) return invalid("provider", REQUIRED);
    if (!PROVIDERS.includes(body.provider)) {
      return invalid("provider", `"${body.provider}" is not a valid choice.`);
    }
    const invoice = state.invoices.find((row) => row.id === request.params["invoiceId"]);
    if (!invoice) return fail(404, "Not found.");
    if (invoice.status === "canceled") {
      return ruleViolation("fee_invoice", VOUCHER_CANCELED(invoice.invoice_no));
    }
    if (Number(invoice.balance_due) <= 0) {
      return ruleViolation("fee_invoice", VOUCHER_SETTLED(invoice.invoice_no));
    }
    const due = new Date();
    due.setDate(due.getDate() + (body.validity_days ?? 30));
    const voucher = buildFeeVoucher({
      fee_invoice: invoice.id,
      invoice_no: invoice.invoice_no,
      student: invoice.student,
      student_name: invoice.student_name,
      provider: body.provider as FeeVoucher["provider"],
      consumer_number: String(1_000_000_000 + state.vouchers.length + 1),
      amount: invoice.balance_due,
      due_date: due.toISOString().slice(0, 10),
      issued_by: state.actorId,
    });
    state.vouchers.push(voucher);
    return ok(voucher, { status: 201, meta: { message: "Voucher issued." } });
  });

  api.post("/vouchers/:voucherAction", (request) => {
    const [voucherId, action] = (request.params["voucherAction"] ?? "").split(":");
    if (action !== "void") return fail(404, "Not found.");
    const { reason } = (request.json() as { reason?: string } | null) ?? {};
    if (reason === undefined) return invalid("reason", REQUIRED);
    if (!reason.trim()) return invalid("reason", BLANK);
    const voucher = state.vouchers.find((row) => row.id === voucherId);
    if (!voucher) return fail(404, "Not found.");
    if (voucher.status === "paid") return ruleViolation("status", VOID_PAID);
    voucher.status = "void";
    voucher.voided_reason = reason;
    return ok(voucher, { meta: { message: "Voucher voided." } });
  });

  api.get("/vouchers/:voucherId/download", (request): MockResponse => {
    const voucherId = request.params["voucherId"];
    if (!state.vouchers.some((row) => row.id === voucherId)) return fail(404, "Not found.");
    state.voucherDownloads.push({
      voucherId: voucherId ?? "",
      format: request.searchParams.get("format"),
    });
    return { status: 200, body: PDF_VOUCHER_BODY, headers: { "content-type": "application/pdf" } };
  });
}

/**
 * Refunds: `POST /refunds:create`, then `:approve`, `:reject` and `:process`, each in the server's
 * words. A request is bounded by what is still refundable on the payment (a refund requested,
 * approved or processed counts), with the remainder in `meta.refundable_remainder`; only a
 * confirmed payment can be refunded; the requester cannot approve or reject their own refund
 * (422 under `approved_by`); a refund already decided cannot be decided again; only an approved
 * one is processed. `:create` and `:process` replay an `Idempotency-Key`.
 */
function registerRefundRoutes(api: MockApi, state: CollectionState) {
  const createReplays = new Map<string, { body: string; response: MockResponse }>();
  const processReplays = new Map<string, { body: string; response: MockResponse }>();

  api.post("/refunds:collectionAction", (request) => {
    if (request.params["collectionAction"] !== ":create") return fail(404, "Not found.");
    const body =
      (request.json() as { payment?: string; amount?: string; reason?: string } | null) ?? {};
    if (!body.payment) return invalid("payment", REQUIRED);
    if (body.amount === undefined) return invalid("amount", REQUIRED);
    if (Number(body.amount) <= 0) return invalid("amount", REFUND_POSITIVE);
    if (body.reason === undefined) return invalid("reason", REQUIRED);
    if (!body.reason.trim()) return invalid("reason", BLANK);
    const payment = state.payments.find((row) => row.id === body.payment);
    if (!payment) return fail(404, "Not found.");

    return idempotentWrite(createReplays, request.headers["idempotency-key"], body, () => {
      if (payment.status !== "confirmed") return ruleViolation("payment", REFUND_NOT_CONFIRMED);
      const committed = state.refunds
        .filter((row) => row.payment === payment.id && row.status !== "rejected")
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const remaining = money(Number(payment.amount) - committed);
      const amount = money(Number(body.amount));
      if (Number(amount) > Number(remaining)) {
        return ruleViolation("amount", REFUND_OVER(amount, remaining), {
          refundable_remainder: remaining,
        });
      }
      const refund = buildFeeRefund({
        payment: payment.id,
        invoice_no: payment.invoice_no,
        student: payment.student,
        student_name: payment.student_name,
        amount,
        reason: body.reason ?? "",
        requested_by: state.actorId,
      });
      state.refunds.push(refund);
      return ok(refund, { status: 201, meta: { message: "Refund requested." } });
    });
  });

  api.post("/refunds/:refundAction", (request) => {
    const [refundId, action] = (request.params["refundAction"] ?? "").split(":");
    if (!["approve", "reject", "process"].includes(action ?? "")) return fail(404, "Not found.");
    const body = (request.json() as Record<string, string | null> | null) ?? {};

    if (action === "process") {
      if (!body["method"]) return invalid("method", REQUIRED);
      if (!["cash", "cheque", "bank_transfer", "card", "online_gateway"].includes(body["method"])) {
        return invalid("method", `"${body["method"]}" is not a valid choice.`);
      }
    }
    const refund = state.refunds.find((row) => row.id === refundId);
    if (!refund) return fail(404, "Not found.");

    if (action === "process") {
      return idempotentWrite(processReplays, request.headers["idempotency-key"], body, () => {
        if (refund.status !== "approved") return ruleViolation("status", REFUND_NOT_APPROVED);
        refund.status = "processed";
        refund.method = body["method"] ?? null;
        refund.reference_no = body["reference_no"] ?? null;
        refund.processed_at = new Date().toISOString();
        return ok(refund, { meta: { message: "Refund processed." } });
      });
    }
    if (refund.status !== "requested")
      return ruleViolation("status", REFUND_DECIDED(refund.status));
    if (refund.requested_by === state.actorId) return ruleViolation("approved_by", REFUND_SELF);
    refund.status = action === "approve" ? "approved" : "rejected";
    refund.approved_by = state.actorId;
    refund.decision_note = body["note"] || null;
    return ok(refund, {
      meta: { message: action === "approve" ? "Refund approved." : "Refund rejected." },
    });
  });
}

/**
 * The settlement import: `POST /voucher-collection-imports` (multipart `file` and `provider`) is
 * a 202 + a job; the CSV (`consumer_number,transaction_reference,amount,paid_on`) is matched
 * against the issued vouchers of that provider. A row with no open voucher, or whose amount
 * differs from the voucher's, lands in `exceptions` with the server's reason; a match marks the
 * voucher paid and records a payment. A missing file or unknown provider is a 422.
 */
function registerSettlementRoutes(api: MockApi, state: CollectionState) {
  const replays = new Map<string, { body: string; response: MockResponse }>();

  api.get("/voucher-collection-imports", (request) => {
    const params = request.searchParams;
    const matching = [...state.imports]
      .reverse()
      .filter(
        (row) =>
          (!params.get("status") || row.status === params.get("status")) &&
          (!params.get("provider") || row.provider === params.get("provider")),
      );
    return cursorPageOf(matching, params);
  });

  api.get("/voucher-collection-imports/:importId", (request) => {
    const record = state.imports.find((row) => row.id === request.params["importId"]);
    return record ? ok(record) : fail(404, "Not found.");
  });

  api.post("/voucher-collection-imports", (request) => {
    const fields = multipartFields(request);
    const file = fields["file"];
    const provider = fields["provider"]?.value;
    if (!file?.filename) return ruleViolation("file", IMPORT_NO_FILE);
    if (!provider || !PROVIDERS.includes(provider)) {
      return ruleViolation("provider", IMPORT_UNKNOWN_PROVIDER);
    }

    // The server binds the key to the provider and the file's digest; the text stands for it.
    return idempotentWrite(
      replays,
      request.headers["idempotency-key"],
      { provider, file: file.value },
      () => {
        const { matched, exceptions, rowCount } = reconcile(state, provider, file.value);
        const record: FeeSettlementImport = {
          id: uuid(),
          provider: provider as FeeSettlementImport["provider"],
          file: uuid(),
          imported_by: state.actorId,
          status: "completed",
          row_count: rowCount,
          matched_count: matched,
          exceptions,
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        state.imports.push(record);
        const jobId = uuid();
        state.jobs[jobId] = [
          { status: "running", progress: 40 },
          {
            status: "succeeded",
            progress: 100,
            result: { row_count: rowCount, matched, exceptions: exceptions.length },
          },
        ];
        return ok(
          { job_id: jobId, status: "queued" },
          { status: 202, meta: { message: "Settlement import queued." } },
        );
      },
    );
  });
}

/** `apply_settlement_rows`, in miniature: match by consumer number and amount, post what matches. */
function reconcile(state: CollectionState, provider: string, csv: string) {
  const [header = "", ...lines] = csv.split(/\r?\n/).filter((line) => line.trim());
  const columns = header.split(",").map((column) => column.trim().toLowerCase());
  const exceptions: { row: number; provider_reference: string; amount: string; reason: string }[] =
    [];
  let matched = 0;
  lines.forEach((line, index) => {
    const row = index + 2;
    const cells = line.split(",").map((cell) => cell.trim());
    const get = (name: string) => cells[columns.indexOf(name)] ?? "";
    const consumer = get("consumer_number");
    const reference = get("transaction_reference");
    const amount = get("amount");
    const voucher = state.vouchers.find(
      (candidate) =>
        candidate.consumer_number === consumer &&
        candidate.provider === provider &&
        candidate.status === "issued",
    );
    if (!voucher) {
      exceptions.push({
        row,
        provider_reference: reference,
        amount,
        reason: `No open voucher with consumer number '${consumer}' for ${provider}.`,
      });
      return;
    }
    if (Number(amount).toFixed(2) !== voucher.amount) {
      exceptions.push({
        row,
        provider_reference: reference,
        amount,
        reason: `Settled ${amount} against a voucher for ${voucher.amount}.`,
      });
      return;
    }
    const invoice = state.invoices.find((candidate) => candidate.id === voucher.fee_invoice);
    const payment = buildFeePayment({
      fee_invoice: voucher.fee_invoice,
      invoice_no: voucher.invoice_no,
      student: voucher.student,
      student_name: voucher.student_name,
      amount: voucher.amount,
      method: "bank_transfer",
      reference_no: reference,
      paid_at: new Date().toISOString(),
      receipt_no: `RCP-E2E-S${String(state.payments.length + 1).padStart(3, "0")}`,
    });
    state.payments.push(payment);
    voucher.status = "paid";
    voucher.payment = payment.id;
    if (invoice) {
      invoice.paid_total = money(Number(invoice.paid_total) + Number(voucher.amount));
      invoice.balance_due = money(Number(invoice.balance_due) - Number(voucher.amount));
      invoice.status = Number(invoice.balance_due) === 0 ? "paid" : "partially_paid";
    }
    matched += 1;
  });
  return { matched, exceptions, rowCount: lines.length };
}
