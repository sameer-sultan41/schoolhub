import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * `/students` — the directory table plus its toolbar (stat cards, Export CSV, Import CSV,
 * New student) and its dialogs: create/edit (`StudentCreateStepper`), withdraw confirmation
 * (`WithdrawStudentDialog`, behind each row's "Withdraw" action) and the shared bulk
 * import dialog (`BulkImportDialog`). See `apps/dashboard/src/features/students/`.
 *
 * The wizard and the detail sheet a row opens have page objects of their own under
 * `./students/` (`StudentCreateStepperPage`, `StudentDetailPage`); neither has a route.
 */
export class StudentsPage extends BasePage {
  readonly path = "/students";

  get table(): Locator {
    return this.page.getByRole("table");
  }

  /** Same pattern as `StaffPage.row` — scoped to the table and matched on raw text,
   * not the row's computed accessible name. */
  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get searchInput(): Locator {
    return this.page.getByPlaceholder(/search by name or admission/i);
  }

  get addStudentButton(): Locator {
    return this.page.getByRole("button", { name: "New student", exact: true });
  }

  /**
   * Searches the directory for `name`, then opens that row's detail sheet. Searching
   * first keeps the row on page one however many students the tenant has.
   */
  async openStudent(name: string): Promise<void> {
    await this.searchInput.fill(name);
    await this.row(name).click();
  }

  /** The directory's academic-session filter (`student-directory-filters.tsx`). */
  get sessionFilter(): Locator {
    return this.page.getByRole("combobox", { name: "Academic session", exact: true });
  }

  /**
   * A row's direct Edit or Withdraw action. The accessible name is "{Action} {student
   * name}" (e.g. "Withdraw Ayesha Khan"), not a bare "Edit"/"Withdraw" — a screen-reader
   * user tabbing through many rows needs to hear which row's button they're on, not just
   * which action it is (see `student-columns.tsx`'s `aria-label`).
   */
  rowAction(rowName: string, action: "Edit" | "Withdraw"): Locator {
    return this.row(rowName).getByRole("button", { name: new RegExp(`^${action} `) });
  }

  // ---- Bulk operations: toolbar Export/Import, the import dialog, and ID cards ----

  get exportCsvButton(): Locator {
    return this.page.getByRole("button", { name: "Export CSV" });
  }

  get importCsvButton(): Locator {
    return this.page.getByRole("button", { name: "Import CSV" });
  }

  get importDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Import students" });
  }

  get importFileInput(): Locator {
    return this.importDialog.getByLabel("File");
  }

  get importSubmit(): Locator {
    return this.importDialog.getByRole("button", { name: "Upload" });
  }

  /** The row's selection checkbox, named "Select this student" on every row — hence the
   * row scope. */
  selectRow(name: string | RegExp): Locator {
    return this.row(name).getByRole("checkbox", { name: "Select this student" });
  }

  /** One button whose label tracks the job: "Generate ID cards (n)", then "Generating —
   * n%", then (after a timeout or a failed poll) "Check ID-card status". */
  get idCardsButton(): Locator {
    return this.page.getByRole("button", {
      name: /Generate ID cards|Generating|Check ID-card status/,
    });
  }
}
