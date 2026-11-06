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
