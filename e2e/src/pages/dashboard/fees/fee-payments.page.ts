import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/payments` and its sub-tabs (`?tab=receipts|vouchers|refunds|imports`): each tab's table
 * (named by its caption), the refund actions (Approve, Reject, Process and their dialogs), the
 * voucher Void dialog and the settlement upload dialog with its detail sheet. See
 * `apps/dashboard/src/features/fees/payments/`.
 */
export type PaymentsTab = "payments" | "receipts" | "vouchers" | "refunds" | "imports";

const CAPTION: Record<PaymentsTab, string> = {
  payments: "Payments",
  receipts: "Receipts",
  vouchers: "Vouchers",
  refunds: "Refunds",
  imports: "Settlement imports",
};

export class FeePaymentsPage extends BasePage {
  readonly path = "/fees/payments";

  async gotoTab(tab: PaymentsTab): Promise<void> {
    await this.goto({ path: tab === "payments" ? this.path : `${this.path}?tab=${tab}` });
  }

  tab(name: string): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  /** A tab's table, named by its caption (`payments.<tab>.list.caption`). */
  table(tab: PaymentsTab): Locator {
    return this.page.getByRole("table", { name: CAPTION[tab], exact: true });
  }

  row(tab: PaymentsTab, text: string | RegExp): Locator {
    return this.table(tab).getByRole("row").filter({ hasText: text });
  }

  /** A dialog, by its title. */
  dialog(title: string | RegExp): Locator {
    return this.page.getByRole("dialog", { name: title, exact: true });
  }

  button(name: string | RegExp): Locator {
    return this.page.getByRole("button", { name });
  }

  dateFilter(label: "Paid from" | "Paid to"): Locator {
    return this.page.getByLabel(label, { exact: true });
  }

  select(name: string): Locator {
    return this.page.getByRole("combobox", { name, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }
}
