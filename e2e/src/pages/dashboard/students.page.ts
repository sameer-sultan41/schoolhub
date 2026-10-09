import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * `/students` — the directory table plus its toolbar (stat cards, New student) and its
 * two dialogs: create/edit (`StudentFormDialog`) and withdraw confirmation
 * (`WithdrawStudentDialog`, behind each row's "Withdraw" action). See
 * `apps/dashboard/src/features/students/`.
 *
 * Distinct from `StudentFormPage`/`StudentDetailPage` (`./students/`), which still drive
 * the earlier `/students/new` and `/students/{id}` routes this phase replaced with
 * in-page dialogs — those two stay only for the live-lane
 * `students-admission-enrollment.spec.ts`, pending its own rewrite (see
 * docs/deferred-work.md).
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
   * A row's direct Edit or Withdraw action. The accessible name is "{Action} {student
   * name}" (e.g. "Withdraw Ayesha Khan"), not a bare "Edit"/"Withdraw" — a screen-reader
   * user tabbing through many rows needs to hear which row's button they're on, not just
   * which action it is (see `student-columns.tsx`'s `aria-label`).
   */
  rowAction(rowName: string, action: "Edit" | "Withdraw"): Locator {
    return this.row(rowName).getByRole("button", { name: new RegExp(`^${action} `) });
  }
}
