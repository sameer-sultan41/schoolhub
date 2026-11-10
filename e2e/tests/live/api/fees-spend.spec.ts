import type { ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import { accountantApproverSession, accountantSession, refusal } from "@/lib/live-fees";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Spend (PR D) against the real API, as the seeded roles: the `accountant` records and submits an
 * expense, cannot approve their own, and a second accountant (`e2e-accountant-approver`) approves
 * it and so posts it to the ledger; a budget is the `school_owner`'s alone to approve (the
 * fixture's admin holds that role). Field validation stays in the Django suite
 * (`apps/api/apps/fees_finance/tests/`); this lane pins what only a real stack shows: the
 * segregation-of-duties 422 from the real actor comparison, the real ledger postings the approval
 * makes and the reversal undoes, the account-type rule on categories, and RLS.
 *
 * Endpoints covered: `GET /ledger-accounts`, `POST|DELETE /expense-categories`, `POST|PATCH
 * /expenses`, `POST /expenses/{id}:submit|:approve|:reverse`, `GET /ledger-entries`, `POST /budgets`,
 * `POST /budgets/{id}:approve`.
 */

interface Account {
  id: string;
  code: string;
  account_type: string;
}

interface Category {
  id: string;
}

interface Expense {
  id: string;
  expense_no: string;
  status: string;
  created_by: string | null;
  approved_by: string | null;
  gross_amount: number;
}

interface Budget {
  id: string;
  status: string;
  approved_by: string | null;
}

interface Entry {
  debit: string;
  credit: string;
  reversed_by_transaction_id: string | null;
}

function fieldsOf(error: { details: { field?: string }[] }) {
  return error.details.flatMap((detail) => (detail.field === undefined ? [] : [detail.field]));
}

const today = () => new Date().toISOString().slice(0, 10);
/** A code no other run shares, within the category code's 30 characters. */
const runCode = () =>
  `E2E${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

async function accountOfType(accountant: ApiClient, type: string): Promise<Account> {
  const accounts = await accountant.get<Account[]>("/ledger-accounts", {
    query: { account_type: type },
  });
  const account = accounts.data[0];
  if (!account) throw new Error(`the seeded chart has no ${type} account`);
  return account;
}

async function newCategory(accountant: ApiClient): Promise<Category> {
  const account = await accountOfType(accountant, "expense");
  const code = runCode();
  return (
    await accountant.post<Category>("/expense-categories", {
      name: `E2E ${code}`,
      code,
      ledger_account: account.id,
    })
  ).data;
}

function draftBody(category: string) {
  return {
    expense_category: category,
    description: "E2E printer paper",
    amount: "100.00",
    tax_amount: "15.00",
    expense_date: today(),
    payment_method: "cash",
  };
}

test.describe("spend (live API)", () => {
  test("the creator cannot approve their own expense; a second accountant can, and the ledger moves", async () => {
    const accountant = await accountantSession();
    const approver = await accountantApproverSession();
    const category = await newCategory(accountant);

    const draft = (await accountant.post<Expense>("/expenses", draftBody(category.id))).data;
    expect(draft).toMatchObject({ status: "draft", gross_amount: 115 });
    // The creator is on the wire, so the screen can hide Approve from them.
    expect(draft.created_by).toBeTruthy();
    const submitted = (await accountant.post<Expense>(`/expenses/${draft.id}:submit`)).data;
    expect(submitted.status).toBe("submitted");
    expect(submitted.created_by).toBe(draft.created_by);

    const self = await refusal(accountant.post(`/expenses/${draft.id}:approve`));
    expect(self.status).toBe(422);
    expect(fieldsOf(self)).toContain("approved_by");
    expect(self.message).toContain("cannot approve");

    // Nothing was posted by the refusal.
    const before = await accountant.get<Entry[]>("/ledger-entries", {
      query: { reference_type: "expense", reference_id: draft.id },
    });
    expect(before.data).toHaveLength(0);

    const approved = (await approver.post<Expense>(`/expenses/${draft.id}:approve`)).data;
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBeTruthy();
    expect(approved.approved_by).not.toBe(draft.created_by);

    // Approval posts a balanced transaction for the gross amount.
    const posted = await accountant.get<Entry[]>("/ledger-entries", {
      query: { reference_type: "expense", reference_id: draft.id },
    });
    expect(posted.data.length).toBeGreaterThanOrEqual(2);
    const debits = posted.data.reduce((sum, entry) => sum + Number(entry.debit), 0);
    const credits = posted.data.reduce((sum, entry) => sum + Number(entry.credit), 0);
    expect(debits).toBeCloseTo(115);
    expect(credits).toBeCloseTo(115);

    // An approved expense's figures are fixed.
    const edit = await refusal(accountant.patch(`/expenses/${draft.id}`, { amount: "1.00" }));
    expect(fieldsOf(edit)).toContain("status");

    // Reversing needs a reason, and then marks every posting reversed.
    const noReason = await refusal(approver.post(`/expenses/${draft.id}:reverse`, { reason: "" }));
    expect(fieldsOf(noReason)).toContain("reason");
    const reversed = (
      await approver.post<Expense>(`/expenses/${draft.id}:reverse`, { reason: "E2E reversal" })
    ).data;
    expect(reversed.status).toBe("reversed");
    const after = await accountant.get<Entry[]>("/ledger-entries", {
      query: { reference_type: "expense", reference_id: draft.id },
    });
    expect(after.data.every((entry) => entry.reversed_by_transaction_id !== null)).toBe(true);
  });

  test("a category must map to an expense account, and one with an expense cannot be deleted", async () => {
    const accountant = await accountantSession();
    const income = await accountOfType(accountant, "income");
    const code = runCode();

    const wrongType = await refusal(
      accountant.post("/expense-categories", {
        name: `E2E ${code}`,
        code,
        ledger_account: income.id,
      }),
    );
    expect(wrongType.status).toBe(422);
    expect(fieldsOf(wrongType)).toContain("ledger_account");

    const category = await newCategory(accountant);
    await accountant.post<Expense>("/expenses", draftBody(category.id));
    const inUse = await refusal(accountant.delete(`/expense-categories/${category.id}`));
    expect(inUse.status).toBe(422);
    expect(fieldsOf(inUse)).toContain("id");
  });

  test("a budget is approved by the owner alone, once, and names exactly one target", async ({
    liveApiClient,
  }) => {
    const accountant = await accountantSession();
    const category = await newCategory(accountant);
    const account = await accountOfType(accountant, "expense");
    const body = {
      name: `E2E budget ${runCode()}`,
      period_start: today(),
      period_end: today(),
      amount: "5000.00",
    };

    const both = await refusal(
      accountant.post("/budgets", {
        ...body,
        expense_category: category.id,
        ledger_account: account.id,
      }),
    );
    expect(both.status).toBe(400);
    const neither = await refusal(accountant.post("/budgets", body));
    expect(neither.status).toBe(400);

    const draft = (
      await accountant.post<Budget>("/budgets", { ...body, expense_category: category.id })
    ).data;
    expect(draft.status).toBe("draft");

    // The accountant holds `fees.budget.create`, not `fees.budget.approve`.
    const notTheirs = await refusal(accountant.post(`/budgets/${draft.id}:approve`));
    expect(notTheirs.status).toBe(403);

    const approved = (await liveApiClient.post<Budget>(`/budgets/${draft.id}:approve`)).data;
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBeTruthy();

    const again = await refusal(liveApiClient.post(`/budgets/${draft.id}:approve`));
    expect(again.status).toBe(422);
    expect(fieldsOf(again)).toContain("status");
  });

  test("another tenant's expense and budget are a 404, never a 403", async ({
    liveOtherTenantApiClient,
  }) => {
    const accountant = await accountantSession();
    const category = await newCategory(accountant);
    const expense = (await accountant.post<Expense>("/expenses", draftBody(category.id))).data;
    const budget = (
      await accountant.post<Budget>("/budgets", {
        name: `E2E budget ${runCode()}`,
        expense_category: category.id,
        period_start: today(),
        period_end: today(),
        amount: "10.00",
      })
    ).data;

    expect((await refusal(liveOtherTenantApiClient.get(`/expenses/${expense.id}`))).status).toBe(
      404,
    );
    expect(
      (await refusal(liveOtherTenantApiClient.post(`/expenses/${expense.id}:submit`))).status,
    ).toBe(404);
    expect(
      (await refusal(liveOtherTenantApiClient.post(`/budgets/${budget.id}:approve`))).status,
    ).toBe(404);
  });
});
