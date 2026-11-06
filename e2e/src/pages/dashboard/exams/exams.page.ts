import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams` — the exams list: the table (each exam's name links to its page, with per-row
 * "Edit {exam}" / "Delete {exam}" buttons), the toolbar's "New exam", and `ExamFormDialog`. See
 * `apps/dashboard/src/features/exams/list/`.
 *
 * The Examinations sidebar group is the shell's (`DashboardPage.navGroup`), and the tab bar is
 * `DashboardPage.sectionTab(name, "Examinations")`.
 */
export class ExamsPage extends BasePage {
  readonly path = "/exams";

  /** Named by its caption (`exams.list.caption`). */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Exams", exact: true });
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  /** The exam's name in its row, a link to its page. */
  examLink(name: string): Locator {
    return this.table.getByRole("link", { name, exact: true });
  }

  /** The list's search box (name or description). */
  get search(): Locator {
    return this.page.getByRole("textbox", { name: "Search exams", exact: true });
  }

  get createButton(): Locator {
    return this.page.getByRole("button", { name: "New exam", exact: true });
  }

  /** A row's Edit or Delete button, named "{Action} {exam}" (`exam-columns.tsx`). */
  rowAction(name: string, action: "Edit" | "Delete"): Locator {
    return this.page.getByRole("button", { name: `${action} ${name}`, exact: true });
  }

  get formDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^(New exam|Edit exam)$/ });
  }

  field(label: "Name" | "Weightage (%)" | "Starts on" | "Ends on" | "Description"): Locator {
    return this.formDialog.getByLabel(label, { exact: true });
  }

  formSelect(label: "Academic session" | "Term" | "Exam type" | "Grading scale"): Locator {
    return this.formDialog.getByRole("combobox", { name: label, exact: true });
  }

  /** A select's option; options render in a portal, outside the dialog. */
  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  get saveButton(): Locator {
    return this.formDialog.getByRole("button", { name: "Save", exact: true });
  }
}
