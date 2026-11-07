import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, noContent, ok, type MockResponse } from "../envelope";
import { compareValues, cursorPageOf } from "../list";
import type { MockModule } from "../router";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a status, an id). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time. */
export type LedgerAccount = Writable<ApiSchemas["LedgerAccount"]>;
export type FeeHead = Writable<ApiSchemas["FeeHead"]>;
export type FeeSchedule = Writable<ApiSchemas["FeeSchedule"]>;
export type FeeStructure = Writable<ApiSchemas["FeeStructure"]>;

const STAMP = "2026-10-01T00:00:00Z";

// The server's sentences, verbatim (`services.py`, `FeeScheduleSerializer.validate`), so a screen
// that shows them shows what users see (L5).
const REQUIRED = "This field is required.";
const NO_SCHEDULES = "This structure has no fee schedules, so it would charge nothing.";
const NOT_INCOME = (code: string, name: string, type: string) =>
  `A fee head must map to an income account. ${code} ${name} is ${type}.`;
const HEAD_IN_USE =
  "This fee head is referenced by a fee schedule, a fine or an invoice line. Deactivate it " +
  "instead — historical records still refer to it.";
const SYSTEM_ACCOUNT = (code: string, name: string) =>
  `${code} ${name} is a system account and stays available. Add your own account alongside it instead.`;
const HAS_POSTINGS = (code: string, name: string) =>
  `${code} ${name} has ledger postings and cannot be deleted. Archive it instead — its code ` +
  "stays reserved and its history stays under it.";
const FIXED_STRUCTURE = (status: string) =>
  `This structure is ${status} and its lines are fixed. Invoices have been priced from it. ` +
  "Clone it and edit the copy.";

export function buildLedgerAccount(overrides: Partial<LedgerAccount> = {}): LedgerAccount {
  return {
    id: uuid(),
    code: "4001",
    name: "Tuition income",
    account_type: "income",
    parent: null,
    is_active: true,
    is_system: false,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildFeeHead(overrides: Partial<FeeHead> = {}): FeeHead {
  return {
    id: uuid(),
    name: "Library fee",
    code: "LIB",
    category: "library",
    ledger_account: "",
    is_refundable: false,
    is_active: true,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildFeeSchedule(overrides: Partial<FeeSchedule> = {}): FeeSchedule {
  return {
    id: uuid(),
    fee_structure: "",
    fee_head: "",
    amount: "1500.00",
    frequency: "monthly",
    term: null,
    due_day: 10,
    due_date: null,
    late_fee_policy: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildFeeStructure(overrides: Partial<FeeStructure> = {}): FeeStructure {
  return {
    id: uuid(),
    name: "Grade 1 fees",
    academic_session: "",
    school_class: null,
    campus: null,
    status: "draft",
    schedules: [],
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export interface FeesSetupOptions {
  /** Held by reference, so a spec can read what a write left behind. */
  accounts?: LedgerAccount[];
  heads?: FeeHead[];
  structures?: FeeStructure[];
  /** Account ids with ledger postings: such an account cannot be deleted. */
  accountsWithPostings?: string[];
}

/** 400 under each field, as the envelope handler builds it for a serializer's errors. */
function invalid(details: { field: string; issue: string }[]): MockResponse {
  const [first] = details;
  const message = details.length === 1 && first ? first.issue : "validation_error";
  return fail(400, message, { details });
}

/** A 422 `domain_rule_violation` under `field`, as `DomainRuleViolation({field: issue})`. */
function ruleViolation(field: string, issue: string): MockResponse {
  return fail(422, issue, { code: "domain_rule_violation", details: [{ field, issue }] });
}

const ONE_DAY_OR_DATE = ["one_time", "annual"];
const isUnset = (value: unknown) => value === null || value === undefined;

/** `FeeScheduleSerializer.validate`'s frequency/due-rule pairing, one error per field. */
function dueRuleErrors(schedule: Partial<FeeSchedule>): { field: string; issue: string }[] {
  const frequency = schedule.frequency ?? "one_time";
  const errors: { field: string; issue: string }[] = [];
  if (frequency === "per_term" && !schedule.term) {
    errors.push({ field: "term", issue: "A per-term schedule must name its term." });
  }
  if (frequency !== "per_term" && schedule.term) {
    errors.push({
      field: "term",
      issue:
        "Only a per-term schedule carries a term; otherwise the same charge would be billed in every term.",
    });
  }
  if (frequency === "monthly" && isUnset(schedule.due_day)) {
    errors.push({ field: "due_day", issue: "A monthly schedule needs a day-of-month due rule." });
  }
  if (frequency !== "monthly" && !isUnset(schedule.due_day)) {
    errors.push({
      field: "due_day",
      issue: "Only a monthly schedule uses a day-of-month due rule.",
    });
  }
  if (ONE_DAY_OR_DATE.includes(frequency) && !schedule.due_date) {
    errors.push({ field: "due_date", issue: `A ${frequency} schedule needs a fixed due date.` });
  }
  if (!ONE_DAY_OR_DATE.includes(frequency) && schedule.due_date) {
    errors.push({
      field: "due_date",
      issue: `A ${frequency} schedule takes its due date from its rule.`,
    });
  }
  return errors;
}

/**
 * `/ledger-accounts`, `/fee-heads`, `/fee-structures` (with `:activate` and `:archive`) and
 * `/fee-schedules`, cursor-paged, in the shapes the server sends. A structure's `schedules` are
 * derived from the schedule writes, as the nested read-only field is.
 *
 * Mirrors the server's rules the screens surface (lesson L5), in its words:
 * - `:activate` on a structure with no schedules is a 422 under `status`; so is activating a
 *   second structure at a (session, class, campus) scope that already has an active one;
 * - a schedule's frequency and due rule must pair (a 400 under `term`, `due_day` or `due_date`),
 *   and a schedule write on a structure that is not a draft is a 422 under `fee_structure`;
 * - a fee head must map to an income account (422 under `ledger_account`), and cannot be
 *   deleted while a schedule uses it (422 under `fee_head`);
 * - a system account cannot be archived or deleted, and one with postings cannot be deleted.
 *
 * Whether the server enforces any of this is the live lane's (`tests/live/api/fees-setup.spec.ts`).
 */
export function feesSetupModule(options: FeesSetupOptions = {}): MockModule {
  return (api) => {
    const accounts = options.accounts ?? [];
    const heads = options.heads ?? [];
    const structures = options.structures ?? [];
    const withPostings = options.accountsWithPostings ?? [];

    const findStructure = (structureId: string | undefined) =>
      structures.find((structure) => structure.id === structureId);
    const scheduleHolder = (scheduleId: string | undefined) =>
      structures.find((structure) =>
        structure.schedules.some((schedule) => schedule.id === scheduleId),
      );
    const ordered = <T>(rows: T[], params: URLSearchParams, keys: (keyof T)[]) => {
      const ordering = params.get("ordering");
      const key = keys.find((candidate) => String(candidate) === ordering?.replace(/^-/, ""));
      if (!key) return rows;
      const direction = ordering?.startsWith("-") ? -1 : 1;
      return [...rows].sort((a, b) => direction * compareValues(a[key], b[key]));
    };

    // --- ledger accounts
    api.get("/ledger-accounts", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const matching = accounts.filter(
        (account) =>
          (!params.get("account_type") || account.account_type === params.get("account_type")) &&
          (params.get("is_active") === null ||
            String(account.is_active ?? true) === params.get("is_active")) &&
          (params.get("is_system") === null ||
            String(account.is_system) === params.get("is_system")) &&
          (!search || `${account.code} ${account.name}`.toLowerCase().includes(search)),
      );
      return cursorPageOf(ordered(matching, params, ["code", "name"]), params);
    });

    api.post("/ledger-accounts", (request) => {
      const body = (request.json() as Partial<LedgerAccount> | null) ?? {};
      const missing = (["code", "name", "account_type"] as const).filter((field) => !body[field]);
      if (missing.length > 0) {
        return invalid(missing.map((field) => ({ field, issue: REQUIRED })));
      }
      if (accounts.some((account) => account.code === body.code)) {
        return invalid([{ field: "code", issue: "An account with this code already exists." }]);
      }
      const created = buildLedgerAccount({ ...body, id: uuid(), is_system: false });
      accounts.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/ledger-accounts/:accountId", (request) => {
      const account = accounts.find((row) => row.id === request.params["accountId"]);
      if (!account) return fail(404, "Not found.");
      const body = (request.json() as Partial<LedgerAccount> | null) ?? {};
      if (account.is_system && body.is_active === false) {
        return ruleViolation("is_active", SYSTEM_ACCOUNT(account.code, account.name));
      }
      Object.assign(account, body, { is_system: account.is_system });
      return ok(account);
    });

    api.delete("/ledger-accounts/:accountId", (request) => {
      const account = accounts.find((row) => row.id === request.params["accountId"]);
      if (!account) return fail(404, "Not found.");
      if (account.is_system) {
        return ruleViolation("is_active", SYSTEM_ACCOUNT(account.code, account.name));
      }
      if (withPostings.includes(account.id)) {
        return ruleViolation("id", HAS_POSTINGS(account.code, account.name));
      }
      accounts.splice(accounts.indexOf(account), 1);
      return noContent();
    });

    // --- fee heads
    function headAccountError(accountId: string | undefined): MockResponse | undefined {
      const account = accounts.find((row) => row.id === accountId);
      if (!account || account.account_type === "income") return undefined;
      return ruleViolation(
        "ledger_account",
        NOT_INCOME(account.code, account.name, account.account_type),
      );
    }

    api.get("/fee-heads", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const matching = heads.filter(
        (head) =>
          (!params.get("category") || head.category === params.get("category")) &&
          (params.get("is_active") === null ||
            String(head.is_active ?? true) === params.get("is_active")) &&
          (!search || `${head.code} ${head.name}`.toLowerCase().includes(search)),
      );
      return cursorPageOf(ordered(matching, params, ["code", "name"]), params);
    });

    api.post("/fee-heads", (request) => {
      const body = (request.json() as Partial<FeeHead> | null) ?? {};
      const missing = (["code", "name", "ledger_account"] as const).filter((field) => !body[field]);
      if (missing.length > 0) {
        return invalid(missing.map((field) => ({ field, issue: REQUIRED })));
      }
      const refused = headAccountError(body.ledger_account);
      if (refused) return refused;
      const created = buildFeeHead({ ...body, id: uuid() });
      heads.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/fee-heads/:headId", (request) => {
      const head = heads.find((row) => row.id === request.params["headId"]);
      if (!head) return fail(404, "Not found.");
      const body = (request.json() as Partial<FeeHead> | null) ?? {};
      const refused = body.ledger_account ? headAccountError(body.ledger_account) : undefined;
      if (refused) return refused;
      Object.assign(head, body);
      return ok(head);
    });

    api.delete("/fee-heads/:headId", (request) => {
      const head = heads.find((row) => row.id === request.params["headId"]);
      if (!head) return fail(404, "Not found.");
      const used = structures.some((structure) =>
        structure.schedules.some((schedule) => schedule.fee_head === head.id),
      );
      if (used) return ruleViolation("fee_head", HEAD_IN_USE);
      heads.splice(heads.indexOf(head), 1);
      return noContent();
    });

    // --- fee structures
    api.get("/fee-structures", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const matching = structures.filter(
        (structure) =>
          (!params.get("academic_session_id") ||
            structure.academic_session === params.get("academic_session_id")) &&
          (!params.get("class_id") || structure.school_class === params.get("class_id")) &&
          (!params.get("campus_id") || structure.campus === params.get("campus_id")) &&
          (!params.get("status") || structure.status === params.get("status")) &&
          (!search || structure.name.toLowerCase().includes(search)),
      );
      return cursorPageOf(ordered(matching, params, ["name"]), params);
    });

    api.post("/fee-structures", (request) => {
      const body = (request.json() as Partial<FeeStructure> | null) ?? {};
      const missing = (["name", "academic_session"] as const).filter((field) => !body[field]);
      if (missing.length > 0) {
        return invalid(missing.map((field) => ({ field, issue: REQUIRED })));
      }
      // `status` and `schedules` are read-only: a new structure is a draft with no lines.
      const created = buildFeeStructure({ ...body, id: uuid(), status: "draft", schedules: [] });
      structures.push(created);
      return ok(created, { status: 201 });
    });

    api.get("/fee-structures/:structureId", (request) => {
      const structure = findStructure(request.params["structureId"]);
      return structure ? ok(structure) : fail(404, "Not found.");
    });

    api.patch("/fee-structures/:structureId", (request) => {
      const structure = findStructure(request.params["structureId"]);
      if (!structure) return fail(404, "Not found.");
      const { name, academic_session, school_class, campus } =
        (request.json() as Partial<FeeStructure> | null) ?? {};
      Object.assign(structure, {
        ...(name === undefined ? {} : { name }),
        ...(academic_session === undefined ? {} : { academic_session }),
        ...(school_class === undefined ? {} : { school_class }),
        ...(campus === undefined ? {} : { campus }),
      });
      return ok(structure);
    });

    api.delete("/fee-structures/:structureId", (request) => {
      const structure = findStructure(request.params["structureId"]);
      if (!structure) return fail(404, "Not found.");
      structures.splice(structures.indexOf(structure), 1);
      return noContent();
    });

    // `router.ts` reads `:name` as a param, so `/fee-structures/{id}:activate` lands here whole;
    // no other POST shares the `/fee-structures/{segment}` shape.
    api.post("/fee-structures/:structureAction", (request) => {
      const [structureId, action] = (request.params["structureAction"] ?? "").split(":");
      const structure = findStructure(structureId);
      if (!structure || (action !== "activate" && action !== "archive")) {
        return fail(404, "Not found.");
      }
      if (action === "archive") {
        structure.status = "archived";
        return ok(structure, { meta: { message: "Fee structure archived." } });
      }
      if (structure.schedules.length === 0) return ruleViolation("status", NO_SCHEDULES);
      const clash = structures.find(
        (other) =>
          other.id !== structure.id &&
          other.status === "active" &&
          other.academic_session === structure.academic_session &&
          other.school_class === structure.school_class &&
          other.campus === structure.campus,
      );
      if (clash) {
        return ruleViolation(
          "status",
          `'${clash.name}' is already the active structure for this session, class and campus. ` +
            "Archive it first.",
        );
      }
      structure.status = "active";
      return ok(structure, { meta: { message: "Fee structure activated." } });
    });

    // --- fee schedules
    function checkSchedule(
      structure: FeeStructure | undefined,
      body: Partial<FeeSchedule>,
    ): MockResponse | undefined {
      const errors = dueRuleErrors(body);
      if (errors.length > 0) return invalid(errors);
      if (structure && structure.status !== "draft") {
        return ruleViolation("fee_structure", FIXED_STRUCTURE(structure.status));
      }
      return undefined;
    }

    api.post("/fee-schedules", (request) => {
      const body = (request.json() as Partial<FeeSchedule> | null) ?? {};
      const missing = (["fee_structure", "fee_head", "amount"] as const).filter(
        (field) => !body[field],
      );
      if (missing.length > 0) {
        return invalid(missing.map((field) => ({ field, issue: REQUIRED })));
      }
      const structure = findStructure(body.fee_structure);
      if (!structure) return invalid([{ field: "fee_structure", issue: "Invalid pk." }]);
      const refused = checkSchedule(structure, body);
      if (refused) return refused;
      const created = buildFeeSchedule({ ...body, id: uuid() });
      structure.schedules.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/fee-schedules/:scheduleId", (request) => {
      const structure = scheduleHolder(request.params["scheduleId"]);
      const schedule = structure?.schedules.find((row) => row.id === request.params["scheduleId"]);
      if (!structure || !schedule) return fail(404, "Not found.");
      const body = (request.json() as Partial<FeeSchedule> | null) ?? {};
      const refused = checkSchedule(structure, { ...schedule, ...body });
      if (refused) return refused;
      Object.assign(schedule, body);
      return ok(schedule);
    });

    api.delete("/fee-schedules/:scheduleId", (request) => {
      const structure = scheduleHolder(request.params["scheduleId"]);
      if (!structure) return fail(404, "Not found.");
      if (structure.status !== "draft") {
        return ruleViolation("fee_structure", FIXED_STRUCTURE(structure.status));
      }
      structure.schedules = structure.schedules.filter(
        (row) => row.id !== request.params["scheduleId"],
      );
      return noContent();
    });
  };
}

export type FeeInvoice = Writable<ApiSchemas["FeeInvoice"]>;
export type FeePayment = Writable<ApiSchemas["Payment"]>;
export type FeeVoucher = Writable<ApiSchemas["FeeVoucher"]>;

export function buildFeeInvoice(overrides: Partial<FeeInvoice> = {}): FeeInvoice {
  return {
    id: uuid(),
    invoice_no: "INV-E2E-0001",
    student: "",
    student_name: "Ayesha Khan",
    student_enrollment: null,
    academic_session: "",
    fee_structure: null,
    period_label: null,
    issue_date: "2026-10-01",
    due_date: "2026-10-10",
    status: "issued",
    subtotal: "0.00",
    discount_total: "0.00",
    fine_total: "0.00",
    paid_total: "0.00",
    balance_due: "0.00",
    canceled_reason: null,
    lines: [],
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildFeePayment(overrides: Partial<FeePayment> = {}): FeePayment {
  return {
    id: uuid(),
    fee_invoice: "",
    student: "",
    amount: "500.00",
    method: "cash",
    reference_no: null,
    gateway_provider: null,
    status: "confirmed",
    paid_at: "2026-10-05T09:00:00Z",
    received_by: null,
    receipt_no: "RCT-E2E-0001",
    created_at: STAMP,
    ...overrides,
  };
}

export function buildFeeVoucher(overrides: Partial<FeeVoucher> = {}): FeeVoucher {
  return {
    id: uuid(),
    fee_invoice: "",
    invoice_no: "INV-E2E-0001",
    student: "",
    student_name: "Ayesha Khan",
    provider: "bank_branch",
    consumer_number: "1234567890",
    amount: "1500.00",
    due_date: "2026-10-10",
    status: "issued",
    payment: null,
    voided_reason: null,
    issued_by: "",
    created_at: STAMP,
    ...overrides,
  };
}

/** A student the structure bills: the stub raises one invoice per billable student. */
export interface BillableStudent {
  id: string;
  name: string;
}

export interface FeesInvoicingOptions {
  /** Held by reference, so a spec can read what a write left behind. */
  invoices?: FeeInvoice[];
  payments?: FeePayment[];
  vouchers?: FeeVoucher[];
  /** The structures `:generate` bills from: the same array `feesSetupModule` serves. */
  structures?: FeeStructure[];
  /** The students every generation bills, with the session they sit in. */
  students?: BillableStudent[];
  /** The job sequences `jobsModule` serves, held by reference: a generation writes its job here,
   * so the page's poll finds it. Pass the same object to both modules. */
  jobs?: Record<
    string,
    { status: "succeeded"; progress: number; result: Record<string, unknown> }[]
  >;
}

const NOT_ACTIVE = (name: string, status: string) =>
  `'${name}' is ${status}. Only an active structure prices invoices.`;
const ALREADY_CANCELED = "This invoice is already canceled.";
const PAID_AGAINST = (paid: string) =>
  `${paid} has been paid against this invoice. Refund the payment rather than cancelling the charge.`;
const NEEDS_REASON = "Cancelling an invoice requires a reason.";
const NAME_ONE_PERIOD =
  "Name exactly one of `period_start` (to bill a calendar month) or `term` (to bill a whole term).";

interface GenerateBody {
  fee_structure?: string;
  period_start?: string | null;
  term?: string | null;
}

/**
 * `/fee-invoices` (list, detail, create, `:generate`, `:cancel`) with the invoice's `/payments`
 * and `/vouchers` reads, cursor-paged, in the shapes the server sends.
 *
 * Mirrors the server's rules the screens surface (lesson L5), in its words:
 * - `:generate` on a structure that is not active is a 422 under `fee_structure`; naming both or
 *   neither of `period_start` and `term` is a 400; it answers 202 + a job whose result counts the
 *   invoices raised and the students already billed for that period (a re-run skips them, which
 *   is not an error);
 * - `:cancel` needs a reason (400), refuses an invoice already canceled and one with money paid
 *   against it (422 under `status`), and replays an `Idempotency-Key` on `:generate`;
 * - the list filters by student, session, structure, status and `outstanding` (balance owing and
 *   not canceled), and orders by `issue_date`, `due_date` or `balance_due`.
 *
 * Whether the server enforces any of this is the live lane's (`tests/live/api/fees-invoicing.spec.ts`).
 */
export function feesInvoicingModule(options: FeesInvoicingOptions = {}): MockModule {
  return (api) => {
    const invoices = options.invoices ?? [];
    const payments = options.payments ?? [];
    const vouchers = options.vouchers ?? [];
    const structures = options.structures ?? [];
    const students = options.students ?? [];
    const jobs = options.jobs ?? {};
    const replays = new Map<string, MockResponse>();
    let sequence = invoices.length;

    const find = (invoiceId: string | undefined) =>
      invoices.find((invoice) => invoice.id === invoiceId);
    const owes = (invoice: FeeInvoice) =>
      Number(invoice.balance_due) > 0 && invoice.status !== "canceled";

    api.get("/fee-invoices", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const matching = invoices.filter(
        (invoice) =>
          (!params.get("student") || invoice.student === params.get("student")) &&
          (!params.get("academic_session_id") ||
            invoice.academic_session === params.get("academic_session_id")) &&
          (!params.get("fee_structure_id") ||
            invoice.fee_structure === params.get("fee_structure_id")) &&
          (!params.get("status") || invoice.status === params.get("status")) &&
          (!params.get("period_label") || invoice.period_label === params.get("period_label")) &&
          invoice.due_date >= (params.get("due_date__gte") ?? "") &&
          invoice.due_date <= (params.get("due_date__lte") ?? "9999-12-31") &&
          (params.get("outstanding") === null ||
            owes(invoice) === (params.get("outstanding") === "true")) &&
          (!search ||
            `${invoice.invoice_no} ${invoice.student_name}`.toLowerCase().includes(search)),
      );
      const ordering = params.get("ordering") ?? "-issue_date";
      const key = ordering.replace(/^-/, "") as keyof FeeInvoice;
      const direction = ordering.startsWith("-") ? -1 : 1;
      const ordered = [...matching].sort((a, b) =>
        key === "balance_due"
          ? direction * (Number(a.balance_due) - Number(b.balance_due))
          : direction * compareValues(a[key], b[key]),
      );
      return cursorPageOf(ordered, params);
    });

    api.get("/fee-invoices/:invoiceId", (request) => {
      const invoice = find(request.params["invoiceId"]);
      return invoice ? ok(invoice) : fail(404, "Not found.");
    });

    // `router.ts` reads `:name` as a param, so this compiles to `^/fee-invoices([^/]+)$` and
    // captures ":generate" whole; it never meets `/fee-invoices/{id}`, which has a `/` there.
    api.post("/fee-invoices:collectionAction", (request) => {
      if (request.params["collectionAction"] !== ":generate") return fail(404, "Not found.");
      const key = request.headers["idempotency-key"];
      const replay = key ? replays.get(key) : undefined;
      if (replay) return replay;

      const body = (request.json() as GenerateBody | null) ?? {};
      if (!body.fee_structure) {
        return invalid([{ field: "fee_structure", issue: REQUIRED }]);
      }
      if (Boolean(body.period_start) === Boolean(body.term)) {
        return invalid([{ field: "non_field_errors", issue: NAME_ONE_PERIOD }]);
      }
      const structure = structures.find((row) => row.id === body.fee_structure);
      if (!structure) return fail(404, "Not found.");
      if (structure.status !== "active") {
        return ruleViolation("fee_structure", NOT_ACTIVE(structure.name, structure.status));
      }

      const label = body.period_start ? body.period_start.slice(0, 7) : "Term";
      let issued = 0;
      let skipped = 0;
      for (const student of students) {
        const billed = invoices.some(
          (invoice) =>
            invoice.student === student.id &&
            invoice.fee_structure === structure.id &&
            invoice.period_label === label &&
            invoice.status !== "canceled",
        );
        if (billed) {
          skipped += 1;
          continue;
        }
        const lines = structure.schedules.map((schedule) => ({
          id: uuid(),
          fee_head: schedule.fee_head,
          fee_head_code: "TUI",
          description: "Tuition fee",
          amount: schedule.amount,
          discount_amount: "0.00",
          net_amount: Number(schedule.amount),
          source_type: "schedule" as const,
          source_id: schedule.id,
        }));
        const subtotal = lines.reduce((sum, line) => sum + Number(line.amount), 0).toFixed(2);
        sequence += 1;
        invoices.push(
          buildFeeInvoice({
            invoice_no: `INV-E2E-${String(sequence).padStart(4, "0")}`,
            student: student.id,
            student_name: student.name,
            academic_session: structure.academic_session,
            fee_structure: structure.id,
            period_label: label,
            status: "issued",
            subtotal,
            balance_due: subtotal,
            lines,
          }),
        );
        issued += 1;
      }

      const jobId = uuid();
      jobs[jobId] = [{ status: "succeeded", progress: 100, result: { issued, skipped, rows: [] } }];
      const response = ok(
        { job_id: jobId, status: "queued" },
        { status: 202, meta: { message: "Invoice generation queued." } },
      );
      if (key) replays.set(key, response);
      return response;
    });

    // `/fee-invoices/{id}:cancel` lands here whole; no other POST shares this shape.
    api.post("/fee-invoices/:invoiceAction", (request) => {
      const [invoiceId, action] = (request.params["invoiceAction"] ?? "").split(":");
      const invoice = find(invoiceId);
      if (!invoice || action !== "cancel") return fail(404, "Not found.");
      const { reason } = (request.json() as { reason?: string } | null) ?? {};
      if (!reason) return invalid([{ field: "reason", issue: REQUIRED }]);
      if (!reason.trim()) return ruleViolation("reason", NEEDS_REASON);
      if (invoice.status === "canceled") return ruleViolation("status", ALREADY_CANCELED);
      if (Number(invoice.paid_total) > 0) {
        return ruleViolation("status", PAID_AGAINST(invoice.paid_total));
      }
      invoice.status = "canceled";
      invoice.canceled_reason = reason;
      return ok(invoice, { meta: { message: "Invoice canceled." } });
    });

    api.get("/payments", (request) => {
      const params = request.searchParams;
      const matching = payments.filter(
        (payment) => !params.get("invoice") || payment.fee_invoice === params.get("invoice"),
      );
      return cursorPageOf(matching, params);
    });

    api.get("/vouchers", (request) => {
      const params = request.searchParams;
      const matching = vouchers.filter(
        (voucher) => !params.get("invoice") || voucher.fee_invoice === params.get("invoice"),
      );
      return cursorPageOf(matching, params);
    });
  };
}
