import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/counter`: the student picker, that student's outstanding invoices, and the Record
 * payment dialog (amount, method, reference) with its receipt panel (Print PDF, Print thermal).
 * See `apps/dashboard/src/features/fees/counter/`.
 */
export class FeeCounterPage extends BasePage {
  readonly path = "/fees/counter";

  /** Picks a student through the searchable picker: open it, search, choose the match. */
  async pickStudent(search: string, name: string): Promise<void> {
    await this.page.getByRole("button", { name: "Choose a student", exact: true }).click();
    await this.page.getByRole("textbox", { name: "Search students", exact: true }).fill(search);
    await this.page.getByRole("button", { name }).click();
  }

  /** Named by its caption (`counter.invoices.caption`). */
  get invoicesTable(): Locator {
    return this.page.getByRole("table", { name: "Outstanding invoices", exact: true });
  }

  row(text: string | RegExp): Locator {
    return this.invoicesTable.getByRole("row").filter({ hasText: text });
  }

  recordButton(invoiceNo: string): Locator {
    return this.page.getByRole("button", { name: `Record payment for ${invoiceNo}`, exact: true });
  }

  /** The Record payment dialog, by its title. */
  dialog(invoiceNo: string): Locator {
    return this.page.getByRole("dialog", { name: `Record payment: ${invoiceNo}`, exact: true });
  }

  amount(dialog: Locator): Locator {
    return dialog.getByLabel("Amount", { exact: true });
  }

  methodSelect(dialog: Locator): Locator {
    return dialog.getByRole("combobox", { name: "Method", exact: true });
  }

  submit(dialog: Locator): Locator {
    return dialog.getByRole("button", { name: "Record payment", exact: true });
  }

  printButton(dialog: Locator, which: "PDF" | "thermal"): Locator {
    return dialog.getByRole("button", { name: `Print ${which}`, exact: true });
  }
}
