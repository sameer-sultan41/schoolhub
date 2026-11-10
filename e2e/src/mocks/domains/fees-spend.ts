import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, noContent, ok, type MockResponse } from "../envelope";
import { compareValues, cursorPageOf } from "../list";
import type { MockApi, MockModule } from "../router";
import type { LedgerAccount } from "./fees";

type Writable<T> = { -readonly [K in keyof T]: T[K] };
export type FeeExpense = Writable<ApiSchemas["Expense"]>;
export type FeeExpenseCategory = Writable<ApiSchemas["ExpenseCategory"]>;
export type FeeBudget = Writable<ApiSchemas["Budget"]>;

const STAMP = "2026-10-01T00:00:00Z";

export function buildFeeExpenseCategory(
  overrides: Partial<FeeExpenseCategory> = {},
): FeeExpenseCategory {
  return {
    id: uuid(),
    name: "Stationery",
    code: "STA",
    ledger_account: "",
    parent: null,
    is_active: true,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildFeeExpense(overrides: Partial<FeeExpense> = {}): FeeExpense {
  return {
    id: uuid(),
    expense_no: "EXP-E2E-0001",
    expense_category: "",
    category_name: "Stationery",
    campus: null,
    vendor_name: "Paper Co",
    description: "Printer paper",
    amount: "100.00",
    tax_amount: "15.00",
    gross_amount: 115,
    expense_date: "2026-10-05",
    payment_method: "cash",
    status: "submitted",
    approved_by: null,
    created_by: null,
    receipt_file: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function buildFeeBudget(overrides: Partial<FeeBudget> = {}): FeeBudget {
  return {
    id: uuid(),
    name: "Q4 stationery",
    ledger_account: null,
    expense_category: "",
    campus: null,
    period_start: "2026-10-01",
    period_end: "2026-12-31",
    amount: "5000.00",
    status: "draft",
    approved_by: null,
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export interface FeesSpendOptions {
  /** Held by reference: a create or a transition changes these arrays, so a spec can read them. */
  expenses?: FeeExpense[];
  categories?: FeeExpenseCategory[];
  budgets?: FeeBudget[];
  /** The chart the category rule reads: a category must map to an expense account. */
  accounts?: LedgerAccount[];
  /** The id of the signed-in user, whom the stub treats as the caller: a creator cannot approve
   * their own expense (the server compares `created_by` with the actor). */
  actorId?: string;
}

// The server's sentences, verbatim (`services.py`, `serializers.py`), so a screen that shows them
// shows what users see (L5).
const REQUIRED = "This field is required.";
const EXPENSE_POSITIVE = "An expense must be for a positive amount.";
const SELF_APPROVAL =
  "The person who submitted an expense cannot approve it (§15, and auth-and-rbac §2.4).";
const NOT_SUBMITTED = "Only a submitted expense can be approved or rejected.";
const NOT_APPROVED = "Only an approved expense can be paid.";
const NOT_REVERSIBLE = "Only an approved or paid expense can be reversed.";
const REASON_REQUIRED = "Reversing an expense requires a reason.";
const ALREADY = (status: string) => `This expense is already ${status}.`;
const FIGURES_FIXED = (status: string) =>
  `This expense is ${status} and its figures are fixed. Reject it and record a new one.`;
const NOT_EXPENSE_ACCOUNT = (code: string, name: string, type: string) =>
  `An expense category must map to an expense account. ${code} ${name} is ${type}.`;
const HAS_EXPENSES = (code: string, name: string) =>
  `${code} ${name} has expenses filed against it and cannot be deleted. Set is_active=False instead — its code stays reserved and its history stays under it.`;
const HAS_BUDGET = (code: string, name: string) =>
  `${code} ${name} has a budget against it and cannot be deleted. Set is_active=False instead.`;
const BUDGET_BOTH_OR_NEITHER =
  "Name exactly one of `ledger_account` or `expense_category` — a budget against both is counted twice by the variance report.";
const BUDGET_ALREADY = (status: string) => `This budget is already ${status}.`;

function invalid(field: string, issue: string): MockResponse {
  return fail(400, issue, { details: [{ field, issue }] });
}

function ruleViolation(field: string, issue: string): MockResponse {
  return fail(422, issue, { code: "domain_rule_violation", details: [{ field, issue }] });
}

function ordered<T extends object>(rows: T[], params: URLSearchParams, keys: string[]): T[] {
  const ordering = params.get("ordering") ?? "";
  const key = ordering.replace(/^-/, "");
  if (!keys.includes(key)) return rows;
  const direction = ordering.startsWith("-") ? -1 : 1;
  return [...rows].sort(
    (a, b) =>
      direction *
      compareValues((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * `/expense-categories`, `/expenses` (with every colon-action) and `/budgets` (with `:approve`).
 *
 * Mirrors the server's rules the screens surface (lesson L5), in its words:
 * - a category must map to an expense account (422 under `ledger_account`), and one with an
 *   expense or a budget filed against it cannot be deleted (422 under `id`);
 * - an expense is created as a draft by the caller; only a draft takes an edit or `:submit`
 *   (422 under `status`); `:approve` and `:reject` need a submitted expense, and the creator
 *   cannot approve their own (422 under `approved_by`); `:mark-paid` needs an approved one;
 *   `:reverse` needs an approved or paid one and a reason;
 * - `GET /expenses?awaiting_approval=true` lists only submitted expenses;
 * - a budget names exactly one of an account and a category (400, no field), and `:approve`
 *   moves only a draft.
 *
 * Whether the server really enforces any of this is the live lane's
 * (`tests/live/api/fees-spend.spec.ts`).
 */
export function feesSpendModule(options: FeesSpendOptions = {}): MockModule {
  return (api) => {
    const state = {
      expenses: options.expenses ?? [],
      categories: options.categories ?? [],
      budgets: options.budgets ?? [],
      accounts: options.accounts ?? [],
      actorId: options.actorId ?? "",
    };
    registerCategories(api, state);
    registerExpenses(api, state);
    registerBudgets(api, state);
  };
}

interface SpendState {
  expenses: FeeExpense[];
  categories: FeeExpenseCategory[];
  budgets: FeeBudget[];
  accounts: LedgerAccount[];
  actorId: string;
}

function registerCategories(api: MockApi, state: SpendState) {
  const accountError = (accountId: string | undefined): MockResponse | undefined => {
    const account = state.accounts.find((row) => row.id === accountId);
    if (!account || account.account_type === "expense") return undefined;
    return ruleViolation(
      "ledger_account",
      NOT_EXPENSE_ACCOUNT(account.code, account.name, account.account_type),
    );
  };

  api.get("/expense-categories", (request) => {
    const params = request.searchParams;
    const search = params.get("search")?.toLowerCase();
    const matching = state.categories.filter(
      (category) =>
        (params.get("is_active") === null ||
          String(category.is_active ?? true) === params.get("is_active")) &&
        (!params.get("ledger_account_id") ||
          category.ledger_account === params.get("ledger_account_id")) &&
        (!search || `${category.code} ${category.name}`.toLowerCase().includes(search)),
    );
    return cursorPageOf(ordered(matching, params, ["code", "name"]), params);
  });

  api.post("/expense-categories", (request) => {
    const body = (request.json() as Partial<FeeExpenseCategory> | null) ?? {};
    for (const field of ["name", "code", "ledger_account"] as const) {
      if (!body[field]) return invalid(field, REQUIRED);
    }
    const refused = accountError(body.ledger_account);
    if (refused) return refused;
    const created = buildFeeExpenseCategory({ ...body, id: uuid() });
    state.categories.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/expense-categories/:categoryId", (request) => {
    const category = state.categories.find((row) => row.id === request.params["categoryId"]);
    if (!category) return fail(404, "Not found.");
    const body = (request.json() as Partial<FeeExpenseCategory> | null) ?? {};
    const refused = body.ledger_account ? accountError(body.ledger_account) : undefined;
    if (refused) return refused;
    Object.assign(category, body);
    return ok(category);
  });

  api.delete("/expense-categories/:categoryId", (request) => {
    const category = state.categories.find((row) => row.id === request.params["categoryId"]);
    if (!category) return fail(404, "Not found.");
    if (state.expenses.some((row) => row.expense_category === category.id)) {
      return ruleViolation("id", HAS_EXPENSES(category.code, category.name));
    }
    if (state.budgets.some((row) => row.expense_category === category.id)) {
      return ruleViolation("id", HAS_BUDGET(category.code, category.name));
    }
    state.categories.splice(state.categories.indexOf(category), 1);
    return noContent();
  });
}

interface ExpenseBody {
  expense_category?: string;
  description?: string;
  amount?: string;
  tax_amount?: string;
  expense_date?: string;
  [key: string]: unknown;
}

function gross(expense: Pick<FeeExpense, "amount" | "tax_amount">): number {
  return Number(expense.amount) + Number(expense.tax_amount ?? 0);
}

function registerExpenses(api: MockApi, state: SpendState) {
  const categoryName = (id: string) => state.categories.find((row) => row.id === id)?.name ?? "";

  api.get("/expenses", (request) => {
    const params = request.searchParams;
    const search = params.get("search")?.toLowerCase();
    const matching = state.expenses.filter(
      (expense) =>
        (!params.get("status") || expense.status === params.get("status")) &&
        (params.get("awaiting_approval") !== "true" || expense.status === "submitted") &&
        (!params.get("expense_category_id") ||
          expense.expense_category === params.get("expense_category_id")) &&
        (!params.get("campus_id") || expense.campus === params.get("campus_id")) &&
        (!params.get("expense_date__gte") ||
          expense.expense_date >= (params.get("expense_date__gte") ?? "")) &&
        (!params.get("expense_date__lte") ||
          expense.expense_date <= (params.get("expense_date__lte") ?? "")) &&
        (!search ||
          `${expense.expense_no} ${expense.vendor_name ?? ""} ${expense.description}`
            .toLowerCase()
            .includes(search)),
    );
    return cursorPageOf(ordered(matching, params, ["expense_date", "amount"]), params);
  });

  api.post("/expenses", (request) => {
    const body = (request.json() as ExpenseBody | null) ?? {};
    for (const field of ["expense_category", "description", "amount", "expense_date"] as const) {
      if (!body[field]) return invalid(field, REQUIRED);
    }
    if (Number(body.amount) <= 0) return invalid("amount", EXPENSE_POSITIVE);
    const created = buildFeeExpense({
      ...(body as Partial<FeeExpense>),
      id: uuid(),
      expense_no: `EXP-E2E-${String(state.expenses.length + 1).padStart(4, "0")}`,
      category_name: categoryName(body.expense_category ?? ""),
      status: "draft",
      created_by: state.actorId,
    });
    created.gross_amount = gross(created);
    state.expenses.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/expenses/:expenseId", (request) => {
    const expense = state.expenses.find((row) => row.id === request.params["expenseId"]);
    if (!expense) return fail(404, "Not found.");
    if (expense.status !== "draft") return ruleViolation("status", FIGURES_FIXED(expense.status));
    const body = (request.json() as ExpenseBody | null) ?? {};
    Object.assign(expense, body);
    expense.category_name = categoryName(expense.expense_category);
    expense.gross_amount = gross(expense);
    return ok(expense);
  });

  api.post("/expenses/:expenseAction", (request) => {
    const [expenseId, action] = (request.params["expenseAction"] ?? "").split(":");
    const expense = state.expenses.find((row) => row.id === expenseId);
    if (!expense) return fail(404, "Not found.");

    switch (action) {
      case "submit":
        if (expense.status !== "draft") return ruleViolation("status", ALREADY(expense.status));
        expense.status = "submitted";
        return ok(expense, { meta: { message: "Expense submitted." } });
      case "approve":
      case "reject":
        if (expense.status !== "submitted") return ruleViolation("status", NOT_SUBMITTED);
        if (expense.created_by === state.actorId) {
          return ruleViolation("approved_by", SELF_APPROVAL);
        }
        expense.status = action === "approve" ? "approved" : "rejected";
        expense.approved_by = state.actorId;
        return ok(expense, { meta: { message: `Expense ${expense.status}.` } });
      case "mark-paid":
        if (expense.status !== "approved") return ruleViolation("status", NOT_APPROVED);
        expense.status = "paid";
        return ok(expense, { meta: { message: "Expense marked paid." } });
      case "reverse": {
        const reason = (request.json() as { reason?: string } | null)?.reason;
        if (!reason?.trim()) return ruleViolation("reason", REASON_REQUIRED);
        if (expense.status !== "approved" && expense.status !== "paid") {
          return ruleViolation("status", NOT_REVERSIBLE);
        }
        expense.status = "reversed";
        return ok(expense, { meta: { message: "Expense reversed." } });
      }
      default:
        return fail(404, "Not found.");
    }
  });
}

interface BudgetBody {
  name?: string;
  ledger_account?: string | null;
  expense_category?: string | null;
  period_start?: string;
  period_end?: string;
  amount?: string;
  [key: string]: unknown;
}

function registerBudgets(api: MockApi, state: SpendState) {
  const targetsError = (budget: BudgetBody): MockResponse | undefined =>
    Boolean(budget.ledger_account) === Boolean(budget.expense_category)
      ? fail(400, BUDGET_BOTH_OR_NEITHER, {
          details: [{ field: "non_field_errors", issue: BUDGET_BOTH_OR_NEITHER }],
        })
      : undefined;

  api.get("/budgets", (request) => {
    const params = request.searchParams;
    const matching = state.budgets.filter(
      (budget) =>
        (!params.get("status") || budget.status === params.get("status")) &&
        (!params.get("expense_category_id") ||
          budget.expense_category === params.get("expense_category_id")) &&
        (!params.get("ledger_account_id") ||
          budget.ledger_account === params.get("ledger_account_id")),
    );
    return cursorPageOf(ordered(matching, params, ["period_start", "amount"]), params);
  });

  api.post("/budgets", (request) => {
    const body = (request.json() as BudgetBody | null) ?? {};
    for (const field of ["name", "period_start", "period_end", "amount"] as const) {
      if (!body[field]) return invalid(field, REQUIRED);
    }
    const refused = targetsError(body);
    if (refused) return refused;
    const created = buildFeeBudget({
      ...(body as Partial<FeeBudget>),
      id: uuid(),
      status: "draft",
    });
    state.budgets.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/budgets/:budgetId", (request) => {
    const budget = state.budgets.find((row) => row.id === request.params["budgetId"]);
    if (!budget) return fail(404, "Not found.");
    const body = (request.json() as BudgetBody | null) ?? {};
    const merged = { ...budget, ...body } as BudgetBody;
    const refused = targetsError(merged);
    if (refused) return refused;
    Object.assign(budget, body);
    return ok(budget);
  });

  api.post("/budgets/:budgetAction", (request) => {
    const [budgetId, action] = (request.params["budgetAction"] ?? "").split(":");
    const budget = state.budgets.find((row) => row.id === budgetId);
    if (!budget || action !== "approve") return fail(404, "Not found.");
    if (budget.status !== "draft") return ruleViolation("status", BUDGET_ALREADY(budget.status));
    budget.status = "approved";
    budget.approved_by = state.actorId;
    return ok(budget, { meta: { message: "Budget approved." } });
  });
}
