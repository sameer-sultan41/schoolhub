import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/timetable/periods` — the bell schedule: the table with its per-row Edit/Remove buttons,
 * the toolbar's "Add period", and `PeriodFormDialog`/`DeletePeriodDialog`. See
 * `apps/dashboard/src/features/timetable/periods/`.
 *
 * The Timetable sidebar group is the shell's, so it is `DashboardPage.navGroup`.
 */
export class TimetablePeriodsPage extends BasePage {
  readonly path = "/timetable/periods";

  get table(): Locator {
    return this.page.getByRole("table");
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get addButton(): Locator {
    return this.page.getByRole("button", { name: "Add period", exact: true });
  }

  /** A row's Edit or Remove button, named "{Action} {period}" (`period-columns.tsx`). */
  rowAction(name: string, action: "Edit" | "Remove"): Locator {
    return this.page.getByRole("button", { name: `${action} ${name}`, exact: true });
  }

  get formDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^(Add a period|Edit this period)$/ });
  }

  field(label: "Name" | "Daily order" | "Starts" | "Ends"): Locator {
    return this.formDialog.getByLabel(label, { exact: true });
  }

  /** A weekday toggle, named by the day's full name. */
  weekday(day: string): Locator {
    return this.formDialog.getByRole("button", { name: day, exact: true });
  }

  get breakSwitch(): Locator {
    return this.formDialog.getByRole("switch", { name: "This period is a break" });
  }

  get saveButton(): Locator {
    return this.formDialog.getByRole("button", { name: "Save", exact: true });
  }

  get removeDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  get confirmRemove(): Locator {
    return this.removeDialog.getByRole("button", { name: "Remove", exact: true });
  }
}
