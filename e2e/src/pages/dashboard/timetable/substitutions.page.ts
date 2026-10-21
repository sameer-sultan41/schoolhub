import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/timetable/substitutions` — the cover queue: rows with Approve/Decline/Cancel buttons named
 * "{Action} cover for {absent teacher} on {date}", the toolbar's "Propose a substitution",
 * `ProposeSubstitutionDialog` and the decision confirm. See
 * `apps/dashboard/src/features/timetable/substitutions/`.
 */
export class TimetableSubstitutionsPage extends BasePage {
  readonly path = "/timetable/substitutions";

  get table(): Locator {
    return this.page.getByRole("table");
  }

  row(text: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  rowAction(action: "Approve" | "Decline" | "Cancel", absentTeacher: string): Locator {
    return this.page.getByRole("button", {
      name: new RegExp(`^${action} cover for ${absentTeacher} on `),
    });
  }

  get proposeButton(): Locator {
    return this.page.getByRole("button", { name: "Propose a substitution", exact: true });
  }

  get proposeDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Propose a substitution" });
  }

  proposeSelect(label: "Absent teacher" | "Class to cover" | "Covering teacher"): Locator {
    return this.proposeDialog.getByRole("combobox", { name: label, exact: true });
  }

  get proposeDate(): Locator {
    return this.proposeDialog.getByLabel("Date", { exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  confirm(label: "Approve" | "Decline" | "Cancel cover"): Locator {
    return this.confirmDialog.getByRole("button", { name: label, exact: true });
  }
}
