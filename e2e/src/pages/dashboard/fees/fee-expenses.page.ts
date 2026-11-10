import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/expenses` and its sub-tabs (`?tab=categories|budgets`): each tab's table (named by its
 * caption), the row actions (Approve, Reject, Submit, Mark paid, Reverse and their dialogs), the
 * "Awaiting approval" toggle and the budgets' Approve. See
 * `apps/dashboard/src/features/fees/expenses/`.
 */
export type ExpensesTab = "expenses" | "categories" | "budgets";

const CAPTION: Record<ExpensesTab, string> = {
  expenses: "Expenses",
  categories: "Expense categories",
  budgets: "Budgets",
};

export class FeeExpensesPage extends BasePage {
  readonly path = "/fees/expenses";

  async gotoTab(tab: ExpensesTab): Promise<void> {
    await this.goto({ path: tab === "expenses" ? this.path : `${this.path}?tab=${tab}` });
  }

  /** A tab's table, named by its caption (`expenses.<tab>.list.caption`). */
  table(tab: ExpensesTab): Locator {
    return this.page.getByRole("table", { name: CAPTION[tab], exact: true });
  }

  row(tab: ExpensesTab, text: string | RegExp): Locator {
    return this.table(tab).getByRole("row").filter({ hasText: text });
  }

  /** A row action's button, by its accessible name (`Approve expense EXP-E2E-0001`). */
  button(name: string | RegExp): Locator {
    return this.page.getByRole("button", { name });
  }

  get awaitingApproval(): Locator {
    return this.page.getByRole("button", { name: "Awaiting approval", exact: true });
  }

  /** A form dialog, by its title. */
  dialog(title: string | RegExp): Locator {
    return this.page.getByRole("dialog", { name: title, exact: true });
  }

  /** A confirm dialog (Submit, Approve, Reject, Mark paid, Delete). */
  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }
}
