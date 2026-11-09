import { uuid } from "@/data/factories";
import { fail, ok, type MockResponse } from "../envelope";
import { buildFeePayment, type FeeInvoice, type FeePayment } from "./fees";
import type { MockModule } from "../router";

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

function ruleViolation(field: string, issue: string): MockResponse {
  return fail(422, issue, { code: "domain_rule_violation", details: [{ field, issue }] });
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
        return replay.body === serialized
          ? replay.response
          : ruleViolation(
              "non_field_errors",
              "This Idempotency-Key was already used with a different request. Use a new key for a new request.",
            );
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
      const receiptNo = `RCT-E2E-${String(receipts.length + 1).padStart(4, "0")}`;
      const payment = buildFeePayment({
        fee_invoice: invoice.id,
        student: invoice.student,
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
  };
}
