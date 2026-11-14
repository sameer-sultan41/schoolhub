import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, ok, type MockResponse } from "../envelope";
import { compareValues, cursorPageOf } from "../list";
import type { MockApi } from "../router";
import type { LedgerAccount } from "./fees";

type Writable<T> = { -readonly [K in keyof T]: T[K] };
export type FeeLedgerEntry = Writable<ApiSchemas["LedgerEntry"]>;

export function buildFeeLedgerEntry(overrides: Partial<FeeLedgerEntry> = {}): FeeLedgerEntry {
  return {
    id: uuid(),
    transaction_id: uuid(),
    entry_date: "2026-10-05",
    ledger_account: "",
    account_code: "4001",
    account_name: "Tuition income",
    debit: "0.00",
    credit: "0.00",
    reference_type: "manual",
    reference_id: null,
    memo: "Opening balance",
    reversed_by_transaction_id: null,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

/** What `POST /ledger-entries:post-journal` reads. */
interface JournalBody {
  entry_date?: string;
  memo?: string;
  lines?: { ledger_account?: string; debit?: string; credit?: string }[];
}

export interface JournalState {
  /** Held by reference: a posting appends here, so a spec can read what the server holds. */
  entries: FeeLedgerEntry[];
  accounts: LedgerAccount[];
}

// The server's sentences, verbatim (`serializers.py`, `core/money/__init__.py`, `ledger.py`), so a
// screen that shows them shows what users see (L5).
const REQUIRED = "This field is required.";
const BLANK = "This field may not be blank.";
const TWO_LINES = "A double-entry posting has at least two lines — one debit and one credit.";
const NEGATIVE = "A negative amount on one side is the other side; use the other field.";
const ONE_SIDE = "Each line carries exactly one of debit or credit, and it must be positive.";
const NO_ACCOUNT = "This posting references a ledger account that does not exist.";
const ARCHIVED =
  "This posting references an archived ledger account. Archived accounts keep their history but accept no new postings.";

/** Whole cents of a decimal string: the stub sums as the server does, exactly. */
function cents(value: string | undefined): number {
  return Math.round(Number(value ?? "0") * 100);
}
const decimal = (value: number) => (value / 100).toFixed(2);

function invalid(field: string, issue: string): MockResponse {
  return fail(400, issue, { details: [{ field, issue }] });
}

/**
 * `GET /ledger-entries` (filters `account`, `reference_type`, `date__gte`, `date__lte`, `search`
 * on the memo) and `POST /ledger-entries:post-journal`.
 *
 * The post mirrors the server's rules in its words: a memo is required (400 under `memo`), at
 * least two lines (400 under `lines`), each line carries exactly one positive side (400 under
 * `lines[i].non_field_errors`), an unknown or archived account is refused, and a set whose
 * debits differ from its credits is a 422 naming both totals. A repeated `Idempotency-Key`
 * replays the first answer instead of posting again. Whether the server really enforces any of
 * this is the live lane's (`tests/live/api/fees-spend.spec.ts`).
 */
export function registerJournal(api: MockApi, state: JournalState) {
  const replays = new Map<string, MockResponse>();

  api.get("/ledger-entries", (request) => {
    const params = request.searchParams;
    const search = params.get("search")?.toLowerCase();
    const matching = state.entries.filter(
      (entry) =>
        (!params.get("account") || entry.ledger_account === params.get("account")) &&
        (!params.get("reference_type") || entry.reference_type === params.get("reference_type")) &&
        (!params.get("date__gte") || entry.entry_date >= (params.get("date__gte") ?? "")) &&
        (!params.get("date__lte") || entry.entry_date <= (params.get("date__lte") ?? "")) &&
        (!search || (entry.memo ?? "").toLowerCase().includes(search)),
    );
    const direction = params.get("ordering") === "entry_date" ? 1 : -1;
    const ordered = [...matching].sort(
      (a, b) => direction * compareValues(a.entry_date, b.entry_date),
    );
    return cursorPageOf(ordered, params);
  });

  api.post("/ledger-entries:action", (request) => {
    if ((request.params["action"] ?? "").replace(/^:/, "") !== "post-journal") {
      return fail(404, "Not found.");
    }
    const key = request.headers["idempotency-key"];
    const replay = key ? replays.get(key) : undefined;
    if (replay) return replay;

    const body = (request.json() as JournalBody | null) ?? {};
    if (!body.entry_date) return invalid("entry_date", REQUIRED);
    if (body.memo === undefined) return invalid("memo", REQUIRED);
    if (!body.memo.trim()) return invalid("memo", BLANK);
    const lines = body.lines ?? [];
    if (lines.length < 2) return invalid("lines", TWO_LINES);
    for (const [index, line] of lines.entries()) {
      const debit = cents(line.debit);
      const credit = cents(line.credit);
      const field = `lines[${index}].non_field_errors`;
      if (debit < 0 || credit < 0) return invalid(field, NEGATIVE);
      if (Boolean(debit) === Boolean(credit)) return invalid(field, ONE_SIDE);
    }

    const totalDebit = lines.reduce((sum, line) => sum + cents(line.debit), 0);
    const totalCredit = lines.reduce((sum, line) => sum + cents(line.credit), 0);
    const accounts = lines.map((line) => state.accounts.find((a) => a.id === line.ledger_account));
    const unknown = accounts.some((account) => account === undefined);
    if (totalDebit !== totalCredit) {
      const issue =
        `This posting does not balance: debits total ${decimal(totalDebit)} and credits total ` +
        `${decimal(totalCredit)}, a difference of ${decimal(Math.abs(totalDebit - totalCredit))}.`;
      return fail(422, issue, {
        code: "domain_rule_violation",
        details: [{ field: "non_field", issue }],
      });
    }
    if (unknown) {
      return fail(422, NO_ACCOUNT, {
        code: "domain_rule_violation",
        details: [{ field: "non_field", issue: NO_ACCOUNT }],
      });
    }
    if (accounts.some((account) => account?.is_active === false)) {
      return fail(422, ARCHIVED, {
        code: "domain_rule_violation",
        details: [{ field: "non_field", issue: ARCHIVED }],
      });
    }

    const transactionId = uuid();
    const posted = lines.map((line, index) =>
      buildFeeLedgerEntry({
        transaction_id: transactionId,
        entry_date: body.entry_date,
        ledger_account: line.ledger_account ?? "",
        account_code: accounts[index]?.code ?? "",
        account_name: accounts[index]?.name ?? "",
        debit: decimal(cents(line.debit)),
        credit: decimal(cents(line.credit)),
        memo: body.memo,
      }),
    );
    state.entries.push(...posted);
    const response = ok(posted, { status: 201, meta: { message: "Journal entry posted." } });
    if (key) replays.set(key, response);
    return response;
  });
}
