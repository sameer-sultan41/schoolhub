import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/invoices` and an invoice's own page (`/fees/invoices/{id}`): the invoices table (each
 * number a link to the page) with its Defaulters switch and status filter, the toolbar's
 * "Generate invoices", the generate dialog (structure, month or term, and the
 * job's created and skipped counts), and an invoice page's lines, server totals and Cancel
 * dialog. See `apps/dashboard/src/features/fees/invoices/`.
 */
export class FeeInvoicesPage extends BasePage {
  readonly path = "/fees/invoices";

  async gotoInvoice(invoiceId: string): Promise<void> {
    await this.goto({ path: `${this.path}/${invoiceId}` });
  }

  /** Named by its caption (`invoices.list.caption`). */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Fee invoices", exact: true });
  }

  row(text: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  invoiceLink(number: string): Locator {
    return this.table.getByRole("link", { name: number, exact: true });
  }

  get generateButton(): Locator {
    return this.page.getByRole("button", { name: "Generate invoices", exact: true });
  }

  get defaultersSwitch(): Locator {
    return this.page.getByRole("switch", { name: "Defaulters only", exact: true });
  }

  /** A dialog, by its title. */
  dialog(title: string | RegExp): Locator {
    return this.page.getByRole("dialog", { name: title, exact: true });
  }

  /** The generate dialog's picks and submit, by label. */
  get generateDialog(): Locator {
    return this.dialog("Generate invoices");
  }

  get structureSelect(): Locator {
    return this.generateDialog.getByRole("combobox", { name: "Fee structure", exact: true });
  }

  get monthInput(): Locator {
    return this.generateDialog.getByLabel("Month", { exact: true });
  }

  get submitGenerate(): Locator {
    return this.generateDialog.getByRole("button", { name: "Generate", exact: true });
  }

  /** The footer's Done, once the run has started (the dialog's corner X is named Close). */
  get closeGenerateButton(): Locator {
    return this.generateDialog.getByRole("button", { name: "Done", exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** The invoice page's lines and totals table, named by its caption. */
  get linesTable(): Locator {
    return this.page.getByRole("table", { name: "Invoice lines and totals", exact: true });
  }

  /** A totals row of the lines table, by its label ("Balance due", "Paid", ...). */
  totalRow(label: string): Locator {
    return this.linesTable.getByRole("row").filter({ hasText: new RegExp(`^${label}`) });
  }

  get cancelButton(): Locator {
    return this.page.getByRole("button", { name: "Cancel invoice", exact: true });
  }

  /** The cancel dialog, by its title ("Cancel invoice {number}"). */
  cancelDialog(number: string): Locator {
    return this.dialog(`Cancel invoice ${number}`);
  }
}
