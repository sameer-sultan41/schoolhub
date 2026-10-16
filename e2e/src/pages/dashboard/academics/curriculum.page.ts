import type { Locator } from "@playwright/test";
import { AcademicsPage } from "./academics-base.page";

/**
 * `/academics/curriculum` — one academic session's class-subject mappings: the table with its
 * filters and per-row Edit/Remove buttons, the toolbar's "Add subject" and "Clone from another
 * session", and their dialogs (`CurriculumFormDialog`, `CloneCurriculumDialog`,
 * `DeleteCurriculumDialog`). See `apps/dashboard/src/features/academics/curriculum/`.
 *
 * The Academics sidebar group is the shell's, so it is `DashboardPage.navGroup`.
 */
export class CurriculumPage extends AcademicsPage {
  readonly path = "/academics/curriculum";

  /** The screen on a given session: `?session=` is the URL's only session carrier, and a
   * link without it means the current one. */
  async gotoSession(sessionId: string): Promise<void> {
    await this.goto({ path: `${this.path}?session=${sessionId}` });
  }

  get table(): Locator {
    return this.page.getByRole("table");
  }

  /** Scoped to the table and matched on raw text, as `StudentsPage.row` is. */
  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get addSubjectButton(): Locator {
    return this.page.getByRole("button", { name: "Add subject", exact: true });
  }

  get cloneButton(): Locator {
    return this.page.getByRole("button", { name: "Clone from another session", exact: true });
  }

  /** The session filter above the table; its trigger shows the resolved session's name. */
  get sessionPicker(): Locator {
    return this.page.getByRole("combobox", { name: "Academic session", exact: true });
  }

  /** The read-only banner a closed or archived session shows. */
  lockedNotice(sessionName: string): Locator {
    return this.page.getByText(`${sessionName} is closed, so its records are read-only.`);
  }

  /**
   * A row's Edit or Remove button. The accessible name is "{Action} {subject}, {class}"
   * (e.g. "Edit Mathematics, Grade 1"), so a screen-reader user tabbing down the table hears
   * which row's button it is (see `curriculum-columns.tsx`'s `aria-label`).
   */
  rowAction(subject: string, className: string, action: "Edit" | "Remove"): Locator {
    return this.page.getByRole("button", {
      name: `${action} ${subject}, ${className}`,
      exact: true,
    });
  }

  // ---- Add/Edit dialog ----

  /** Add and Edit are one dialog; only the title differs. */
  get formDialog(): Locator {
    return this.page.getByRole("dialog", {
      name: /^(Add a subject to a class|Edit curriculum mapping)$/,
    });
  }

  /** Radix Select triggers render as `combobox`, named by their field label. */
  formSelect(label: "Academic session" | "Class" | "Subject" | "Campus"): Locator {
    return this.formDialog.getByRole("combobox", { name: label, exact: true });
  }

  /** By label: this field has no required marker, so an exact match holds. */
  get weeklyPeriodsInput(): Locator {
    return this.formDialog.getByLabel("Weekly periods", { exact: true });
  }

  get saveButton(): Locator {
    return this.formDialog.getByRole("button", { name: "Save", exact: true });
  }

  // ---- Clone dialog ----

  get cloneDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Clone curriculum", exact: true });
  }

  cloneSelect(label: "Copy from" | "Copy into"): Locator {
    return this.cloneDialog.getByRole("combobox", { name: label, exact: true });
  }

  get cloneSubmit(): Locator {
    return this.cloneDialog.getByRole("button", { name: "Clone", exact: true });
  }

  // ---- Remove confirmation ----

  get removeDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  get confirmRemove(): Locator {
    return this.removeDialog.getByRole("button", { name: "Remove", exact: true });
  }
}
