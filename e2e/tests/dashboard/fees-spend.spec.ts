import { expect, test } from "@/fixtures";
import {
  buildRole,
  buildUser,
  FEES_SPEND_ACCOUNTANT_PERMISSIONS,
  FEES_SPEND_VIEWER_PERMISSIONS,
  ORG_IDS,
  uuid,
} from "@/data/factories";
import {
  buildCampus,
  buildFeeBudget,
  buildFeeExpense,
  buildFeeExpenseCategory,
  buildLedgerAccount,
  feesSetupModule,
  feesSpendModule,
  type FeeBudget,
  type FeeExpense,
  type FeeExpenseCategory,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * Spend (PR D) against a stubbed API: the Expenses, Categories and Budgets tabs of
 * `/fees/expenses`. The stub (`feesSpendModule`) enforces the server's rules the screens surface
 * (L5), in its words: a draft-only edit and submit, a submitted-only decision that the creator
 * cannot make, a reason to reverse, a category in use undeletable, a budget naming one target.
 * Whether the server really does is the live lane's (`tests/live/api/fees-spend.spec.ts`).
 */

const mainCampus = buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" });
const expenseAccount = buildLedgerAccount({
  code: "5100",
  name: "Office supplies",
  account_type: "expense",
});
const incomeAccount = buildLedgerAccount({ code: "4001", name: "Tuition income" });

// The seeded `accountant`'s keys for these screens, no wider (L55).
const accountant = buildUser({
  id: uuid(),
  roles: [buildRole({ slug: "accountant", name: "Accountant" })],
  permissions: FEES_SPEND_ACCOUNTANT_PERMISSIONS,
});
// The owner alone holds the budget approval.
const owner = buildUser({
  id: uuid(),
  roles: [buildRole({ slug: "school_owner", name: "School owner" })],
  permissions: [...FEES_SPEND_ACCOUNTANT_PERMISSIONS, "fees.budget.approve"],
});
const viewer = buildUser({ id: uuid(), permissions: FEES_SPEND_VIEWER_PERMISSIONS });

interface Stubbed {
  category: FeeExpenseCategory;
  expenses: FeeExpense[];
  categories: FeeExpenseCategory[];
  budgets: FeeBudget[];
}

function stubSpendApi(
  mockApi: MockApi,
  actorId: string,
  seed: { expenses?: (category: FeeExpenseCategory) => FeeExpense[]; budgets?: boolean } = {},
): Stubbed {
  const category = buildFeeExpenseCategory({ ledger_account: expenseAccount.id });
  const categories = [category];
  const expenses = seed.expenses?.(category) ?? [];
  const budgets = seed.budgets
    ? [buildFeeBudget({ expense_category: category.id, name: "Q4 stationery" })]
    : [];
  mockApi.use(
    feesSetupModule({ accounts: [expenseAccount, incomeAccount] }),
    schoolOrganizationModule({ campuses: [mainCampus] }),
    feesSpendModule({
      expenses,
      categories,
      budgets,
      accounts: [expenseAccount, incomeAccount],
      actorId,
    }),
  );
  return { category, expenses, categories, budgets };
}

const sub = (category: FeeExpenseCategory, overrides: Partial<FeeExpense>) =>
  buildFeeExpense({
    expense_category: category.id,
    category_name: category.name,
    ...overrides,
  });

test.describe("an accountant working the expense queue", () => {
  test.use({ authUser: accountant });

  test("sees only submitted expenses behind Awaiting approval, and no Approve on their own", async ({
    mockApi,
    feeExpensesPage,
    signedIn: _signedIn,
  }) => {
    stubSpendApi(mockApi, accountant.id, {
      expenses: (category) => [
        sub(category, {
          expense_no: "EXP-E2E-0001",
          description: "Printer paper",
          created_by: uuid(),
        }),
        sub(category, {
          expense_no: "EXP-E2E-0002",
          description: "Whiteboard markers",
          created_by: accountant.id,
        }),
        sub(category, {
          expense_no: "EXP-E2E-0003",
          description: "Chalk",
          status: "draft",
          created_by: accountant.id,
        }),
      ],
    });
    await feeExpensesPage.gotoTab("expenses");

    await expect(feeExpensesPage.row("expenses", "Chalk")).toBeVisible();
    await feeExpensesPage.awaitingApproval.click();
    await expect(feeExpensesPage.row("expenses", "Chalk")).toHaveCount(0);
    await expect(feeExpensesPage.row("expenses", "Printer paper")).toBeVisible();
    await expect(feeExpensesPage.row("expenses", "Whiteboard markers")).toBeVisible();

    // Someone else's expense can be decided; the viewer's own cannot (segregation of duties).
    await expect(feeExpensesPage.button("Approve expense EXP-E2E-0001")).toBeVisible();
    await expect(feeExpensesPage.button("Reject expense EXP-E2E-0001")).toBeVisible();
    await expect(feeExpensesPage.button("Approve expense EXP-E2E-0002")).toHaveCount(0);
    await expect(feeExpensesPage.button("Reject expense EXP-E2E-0002")).toHaveCount(0);
  });

  test("approves another's expense, marks it paid, then reverses it with a reason", async ({
    mockApi,
    feeExpensesPage,
    signedIn: _signedIn,
  }) => {
    const { expenses } = stubSpendApi(mockApi, accountant.id, {
      expenses: (category) => [sub(category, { expense_no: "EXP-E2E-0001", created_by: uuid() })],
    });
    await feeExpensesPage.gotoTab("expenses");

    await feeExpensesPage.button("Approve expense EXP-E2E-0001").click();
    await feeExpensesPage.confirmDialog
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(
      feeExpensesPage.row("expenses", "EXP-E2E-0001").getByText("Approved"),
    ).toBeVisible();
    expect(expenses[0]?.status).toBe("approved");

    await feeExpensesPage.button("Mark expense EXP-E2E-0001 paid").click();
    await feeExpensesPage.confirmDialog
      .getByRole("button", { name: "Mark paid", exact: true })
      .click();
    await expect(feeExpensesPage.row("expenses", "EXP-E2E-0001").getByText("Paid")).toBeVisible();

    await feeExpensesPage.button("Reverse expense EXP-E2E-0001").click();
    const dialog = feeExpensesPage.dialog("Reverse expense EXP-E2E-0001");
    await dialog.getByRole("button", { name: "Reverse", exact: true }).click();
    await expect(dialog.getByText("This field is required.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Paid twice");
    await dialog.getByRole("button", { name: "Reverse", exact: true }).click();
    await expect(
      feeExpensesPage.row("expenses", "EXP-E2E-0001").getByText("Reversed"),
    ).toBeVisible();
    expect(expenses[0]?.status).toBe("reversed");
  });

  test("records a draft expense and submits it, then cannot decide it", async ({
    mockApi,
    feeExpensesPage,
    signedIn: _signedIn,
  }) => {
    const { expenses, category } = stubSpendApi(mockApi, accountant.id);
    await feeExpensesPage.gotoTab("expenses");

    await feeExpensesPage.button("New expense").click();
    const dialog = feeExpensesPage.dialog("New expense");
    await dialog.getByRole("combobox", { name: "Category" }).click();
    await feeExpensesPage.option("STA Stationery").click();
    await dialog.getByLabel("Description").fill("Markers");
    await dialog.getByLabel("Amount (before tax)").fill("250.00");
    await dialog.getByLabel("Expense date").fill("2026-10-07");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await expect(feeExpensesPage.row("expenses", "Markers").getByText("Draft")).toBeVisible();
    expect(expenses[0]).toMatchObject({
      expense_category: category.id,
      amount: "250.00",
      status: "draft",
      created_by: accountant.id,
    });

    await feeExpensesPage.button("Submit expense EXP-E2E-0001").click();
    await feeExpensesPage.confirmDialog
      .getByRole("button", { name: "Submit", exact: true })
      .click();
    await expect(feeExpensesPage.row("expenses", "Markers").getByText("Submitted")).toBeVisible();
    await expect(feeExpensesPage.button("Approve expense EXP-E2E-0001")).toHaveCount(0);
  });

  test("shows the server's refusal to delete a category in use", async ({
    mockApi,
    feeExpensesPage,
    signedIn: _signedIn,
  }) => {
    stubSpendApi(mockApi, accountant.id, {
      expenses: (category) => [sub(category, { created_by: uuid() })],
    });
    await feeExpensesPage.gotoTab("categories");

    await expect(feeExpensesPage.row("categories", "Stationery")).toBeVisible();
    await feeExpensesPage.button("Delete Stationery").click();
    await feeExpensesPage.confirmDialog
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      feeExpensesPage.confirmDialog.getByText(
        /has expenses filed against it and cannot be deleted/,
      ),
    ).toBeVisible();
  });

  test("edits a draft budget, and is offered no Approve", async ({
    mockApi,
    feeExpensesPage,
    signedIn: _signedIn,
  }) => {
    stubSpendApi(mockApi, accountant.id, { budgets: true });
    await feeExpensesPage.gotoTab("budgets");

    await expect(feeExpensesPage.row("budgets", "Q4 stationery")).toBeVisible();
    await expect(feeExpensesPage.button("Approve Q4 stationery")).toHaveCount(0);
    await feeExpensesPage.button("Edit Q4 stationery").click();
    const dialog = feeExpensesPage.dialog("Edit budget");
    await dialog.getByLabel("Amount").fill("6000.00");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      feeExpensesPage.row("budgets", "Q4 stationery").getByText("6,000.00"),
    ).toBeVisible();
  });
});

test.describe("the school owner", () => {
  test.use({ authUser: owner });

  test("approves a draft budget, which then offers neither Edit nor Approve", async ({
    mockApi,
    feeExpensesPage,
    signedIn: _signedIn,
  }) => {
    const { budgets } = stubSpendApi(mockApi, owner.id, { budgets: true });
    await feeExpensesPage.gotoTab("budgets");

    await feeExpensesPage.button("Approve Q4 stationery").click();
    await feeExpensesPage.confirmDialog
      .getByRole("button", { name: "Approve", exact: true })
      .click();

    await expect(
      feeExpensesPage.row("budgets", "Q4 stationery").getByText("Approved"),
    ).toBeVisible();
    expect(budgets[0]?.status).toBe("approved");
    await expect(feeExpensesPage.button("Approve Q4 stationery")).toHaveCount(0);
    await expect(feeExpensesPage.button("Edit Q4 stationery")).toHaveCount(0);
  });
});

test.describe("a viewer holding only the expense view key", () => {
  test.use({ authUser: viewer });

  test("reads expenses and is offered no action", async ({
    mockApi,
    feeExpensesPage,
    signedIn: _signedIn,
  }) => {
    stubSpendApi(mockApi, viewer.id, {
      expenses: (category) => [sub(category, { created_by: uuid() })],
    });
    await feeExpensesPage.gotoTab("expenses");

    await expect(feeExpensesPage.row("expenses", "Printer paper")).toBeVisible();
    await expect(feeExpensesPage.button("New expense")).toHaveCount(0);
    await expect(
      feeExpensesPage.button(/^(Approve|Reject|Submit|Edit|Reverse) expense/),
    ).toHaveCount(0);
  });
});
