import type { Locator } from "@playwright/test";
import { AcademicsPage } from "./academics-base.page";

/**
 * `/academics/promotions` — the promotion batches: the table with its status, class and session
 * filters, the toolbar's "New batch" and its dialog (`CreatePromotionBatchDialog`). A batch's
 * own screen is `PromotionBatchPage`. See `apps/dashboard/src/features/academics/promotions/`.
 *
 * The Academics sidebar group is the shell's, so it is `DashboardPage.navGroup`; the tab bar
 * above every Academics screen is `DashboardPage.sectionTab`.
 */
export class PromotionsPage extends AcademicsPage {
  readonly path = "/academics/promotions";

  /** The table is named by its `<caption>`. */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Promotion batches", exact: true });
  }

  /** Scoped to the table and matched on raw text, as `StudentsPage.row` is; each part must be
   * in the row, so `row("Grade 2", "Pending approval")` is that class's pending batch. */
  row(...parts: (string | RegExp)[]): Locator {
    return parts.reduce(
      (rows, part) => rows.filter({ hasText: part }),
      this.table.getByRole("row"),
    );
  }

  /**
   * A batch's link, which is its "From class" cell. Its accessible name carries the sessions
   * too, "{class}, {from} → {to}" (e.g. "Grade 1, 2026-27 → 2027-28"), because one class can
   * have several batches (see `promotion-batch-columns.tsx`'s `aria-label`).
   */
  batchLink(className: string, fromSession: string, toSession: string): Locator {
    return this.page.getByRole("link", {
      name: `${className}, ${fromSession} → ${toSession}`,
      exact: true,
    });
  }

  get newBatchButton(): Locator {
    return this.page.getByRole("button", { name: "New batch", exact: true });
  }

  /** A filter above the table. Radix Select triggers render as `combobox`, named by their
   * `aria-label`. */
  filter(label: "From session" | "From class" | "Status"): Locator {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  // ---- New batch dialog ----

  get createDialog(): Locator {
    return this.page.getByRole("dialog", { name: "New promotion batch", exact: true });
  }

  /** Radix Select triggers render as `combobox`, named by their field label. */
  createSelect(label: "From session" | "To session" | "Class"): Locator {
    return this.createDialog.getByRole("combobox", { name: label, exact: true });
  }

  get createSubmit(): Locator {
    return this.createDialog.getByRole("button", { name: "Create batch", exact: true });
  }

  /** The toast a created batch shows, with its student count. */
  createdToast(students: number): Locator {
    const count = students === 1 ? "1 student" : `${students} students`;
    return this.page.getByText(`Promotion batch created with ${count}.`, { exact: true });
  }
}
