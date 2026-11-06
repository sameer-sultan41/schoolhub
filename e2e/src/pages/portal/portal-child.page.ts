import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * One child's portal pages: attendance, fees and results (with the current admit cards). Each is `/portal/{studentId}/…` and is
 * reached through the shell's tab for the selected child (`PortalPage.tab`), so `path` is only
 * the portal root. See `apps/dashboard/src/features/portal/{attendance,fees,results}/`.
 */
export class PortalChildPage extends BasePage {
  readonly path = "/portal";

  // ---- attendance: a month on the calendar, the same month day by day --------------------

  /** The month's calendar (react-day-picker renders a `grid`). */
  get calendar(): Locator {
    return this.page.getByRole("grid");
  }

  get statusLegend(): Locator {
    return this.page.getByRole("list", { name: "Attendance statuses", exact: true });
  }

  /** The day-by-day table, named by its caption, e.g. "Attendance for November 2026". */
  dayTable(month: string): Locator {
    return this.page.getByRole("table", { name: `Attendance for ${month}`, exact: true });
  }

  /** The server's month percentage, "Attendance this month: 96%". */
  get monthPercentage(): Locator {
    return this.page.getByText(/^Attendance this month:/);
  }

  get previousMonth(): Locator {
    return this.page.getByRole("button", { name: /previous month/i });
  }

  // ---- fees: outstanding and paid invoices, a receipt per paid one ------------------------

  invoice(invoiceNo: string): Locator {
    return this.page.getByRole("link", { name: invoiceNo, exact: true });
  }

  receiptButton(receiptNo: string): Locator {
    return this.page.getByRole("button", { name: `Receipt ${receiptNo}`, exact: true });
  }

  /** An invoice's voucher download, found by its consumer number. */
  voucherButton(consumerNumber: string): Locator {
    return this.page.getByRole("button", { name: new RegExp(`voucher ${consumerNumber}`) });
  }

  /** What an open invoice with no voucher says. */
  get noVoucher(): Locator {
    return this.page.getByText("Ask the school office for a voucher.", { exact: true });
  }

  /** A "Pay" control: there is none, the portal is read-only for money. */
  get payButton(): Locator {
    return this.page.getByRole("button", { name: /\bpay\b/i });
  }

  // ---- results: published results, grouped under their term -------------------------------

  termHeading(term: string): Locator {
    return this.page.getByRole("heading", { level: 2, name: term, exact: true });
  }

  /** An admit card's download, named by its exam. */
  admitCardDownload(examName: string): Locator {
    return this.page.getByRole("button", {
      name: `Download admit card for ${examName}`,
      exact: true,
    });
  }

  /** What the admit-card section says with no current card. */
  get noAdmitCards(): Locator {
    return this.page.getByText("No admit cards", { exact: true });
  }

  /** One result's card, found by the exam's name. */
  result(examName: string): Locator {
    return this.page.getByRole("listitem").filter({ hasText: examName });
  }
}
