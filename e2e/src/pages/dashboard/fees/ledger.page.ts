import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/ledger` — the Accounts table (code, name, type, parent, status, a System badge) with each
 * row's "Edit {name}" and "Delete {name}", and the toolbar's "New account". See
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
}
