import type { Locator } from "@playwright/test";
import { AcademicsPage } from "./academics-base.page";

/** A row's teacher, subject and section, as its action buttons name them. */
export interface AllocationRowLabel {
  teacher: string;
  subject: string;
  className: string;
  sectionName: string;
}

/**
 * `/academics/allocations` — one academic session's teacher allocations: the teacher-load
 * panel, the table with its search and filters and per-row Edit/End/Reinstate/Remove buttons,
 * the toolbar's "Allocate a teacher", and their dialogs (`AllocateTeacherDialog`,
 * `EditAllocationDialog`, `EndAllocationDialog`, `ReinstateAllocationDialog`,
 * `DeleteAllocationDialog`). See `apps/dashboard/src/features/academics/allocations/`.
 *
 * The Academics sidebar group is the shell's, so it is `DashboardPage.navGroup`.
 */
export class AllocationsPage extends AcademicsPage {
  readonly path = "/academics/allocations";

  /** The screen on a given session: `?session=` is the URL's only session carrier, and a
   * link without it means the current one. */
  async gotoSession(sessionId: string): Promise<void> {
    await this.goto({ path: `${this.path}?session=${sessionId}` });
  }

  /** Both tables on this screen are named by their `<caption>`, so a bare `getByRole("table")`
   * would match two. */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Teacher allocations", exact: true });
  }

  /** The teacher-load panel's table, above the allocations. */
  get loadTable(): Locator {
    return this.page.getByRole("table", { name: "Teacher load", exact: true });
  }

  /** Scoped to the table and matched on raw text, as `StudentsPage.row` is; each part must be
   * in the row, so `row("Ayesha Khan", "English")` is that teacher's English row. */
  row(...parts: (string | RegExp)[]): Locator {
    return parts.reduce(
      (rows, part) => rows.filter({ hasText: part }),
      this.table.getByRole("row"),
    );
  }

  /** A teacher's row in the load panel. */
  loadRow(teacher: string): Locator {
    return this.loadTable.getByRole("row").filter({ hasText: teacher });
  }

  get allocateButton(): Locator {
    return this.page.getByRole("button", { name: "Allocate a teacher", exact: true });
  }

  /** The read-only banner a closed or archived session shows. */
  lockedNotice(sessionName: string): Locator {
    return this.page.getByText(`${sessionName} is closed, so its records are read-only.`);
  }

  /** `{class} · {section}`: how the table, and every row action's name, writes a section. */
  sectionLabel(className: string, sectionName: string): string {
    return `${className} · ${sectionName}`;
  }

  /**
   * A row's Edit, End, Reinstate or Remove button. The accessible name is
   * "{Action} {teacher}, {subject}, {class} · {section}" (e.g. "End Ayesha Khan, English,
   * Grade 1 · A"), so a screen-reader user tabbing down the table hears which row's button it
   * is (see `allocation-columns.tsx`'s `aria-label`).
   */
  rowAction(
    action: "Edit" | "End" | "Reinstate" | "Remove",
    { teacher, subject, className, sectionName }: AllocationRowLabel,
  ): Locator {
    return this.page.getByRole("button", {
      name: `${action} ${teacher}, ${subject}, ${this.sectionLabel(className, sectionName)}`,
      exact: true,
    });
  }

  /** Every row action in the table, whichever row and action: for "there are none". */
  get rowActions(): Locator {
    return this.table.getByRole("button", { name: /^(Edit|End|Reinstate|Remove) / });
  }

  // ---- Search and filters ----

  get searchInput(): Locator {
    return this.page.getByRole("textbox", { name: "Search", exact: true });
  }

  /** The session filter above the table; its trigger shows the resolved session's name. */
  get sessionPicker(): Locator {
    return this.page.getByRole("combobox", { name: "Academic session", exact: true });
  }

  /** A filter above the table. Radix Select triggers render as `combobox`, named by their
   * `aria-label`; "Status" is Current, Ended or All. */
  filter(label: "Class" | "Section" | "Subject" | "Teacher" | "Status"): Locator {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  // ---- Allocate / Edit dialog ----

  /** Allocate and Edit are one form in one dialog; only the title differs. */
  get formDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^(Allocate a teacher|Edit allocation)$/ });
  }

  formSelect(label: "Class" | "Section" | "Subject" | "Teacher"): Locator {
    return this.formDialog.getByRole("combobox", { name: label, exact: true });
  }

  get primarySwitch(): Locator {
    return this.formDialog.getByRole("switch", { name: "Primary teacher", exact: true });
  }

  get weeklyPeriodsInput(): Locator {
    return this.formDialog.getByLabel("Weekly periods", { exact: true });
  }

  get effectiveFromInput(): Locator {
    return this.formDialog.getByLabel("Effective from", { exact: true });
  }

  get saveButton(): Locator {
    return this.formDialog.getByRole("button", { name: "Save", exact: true });
  }

  // ---- End, Reinstate and Remove confirmations ----

  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  confirm(action: "End" | "Reinstate" | "Remove"): Locator {
    return this.confirmDialog.getByRole("button", { name: action, exact: true });
  }
}
