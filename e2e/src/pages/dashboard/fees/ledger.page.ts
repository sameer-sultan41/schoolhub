import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/ledger` — the Accounts table (code, name, type, parent, status, a System badge) with each
 * row's "Edit {name}" and "Delete {name}", and the toolbar's "New account"; and the Journal tab
 * (`?tab=journal`): the entries table, "Post journal" and its dialog. See
 * `apps/dashboard/src/features/fees/ledger/`.
 */
export class LedgerPage extends BasePage {
  readonly path = "/fees/ledger";

  /** Named by its caption (`ledger.accounts.list.caption`). */
  get accountsTable(): Locator {
    return this.page.getByRole("table", { name: "Ledger accounts", exact: true });
  }

  row(name: string | RegExp): Locator {
    return this.accountsTable.getByRole("row").filter({ hasText: name });
  }

  get createButton(): Locator {
    return this.page.getByRole("button", { name: "New account", exact: true });
  }

  rowAction(name: string, action: "Edit" | "Delete"): Locator {
    return this.page.getByRole("button", { name: `${action} ${name}`, exact: true });
  }

  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  async gotoJournal(): Promise<void> {
    await this.goto({ path: `${this.path}?tab=journal` });
  }

  /** Named by its caption (`ledger.journal.list.caption`). */
  get journalTable(): Locator {
    return this.page.getByRole("table", { name: "Ledger journal", exact: true });
  }

  journalRow(text: string | RegExp): Locator {
    return this.journalTable.getByRole("row").filter({ hasText: text });
  }

  get postButton(): Locator {
    return this.page.getByRole("button", { name: "Post journal", exact: true });
  }

  /** The Post journal dialog (`ledger.journal.form.title`). */
  get journalDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Post journal entry", exact: true });
  }

  /** One line's group in the dialog (`Line 1`). */
  journalLine(number: number): Locator {
    return this.journalDialog.getByRole("group", { name: `Line ${number}`, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }
}
