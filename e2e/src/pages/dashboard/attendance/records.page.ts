import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/attendance/records` — every attendance row the viewer may read, newest day first, under
 * date-range, Class/Section, Status and Locked filters, paged by Previous and Next. See
 * `apps/dashboard/src/features/attendance/records/`.
 */
export class AttendanceRecordsPage extends BasePage {
  readonly path = "/attendance/records";

  get table(): Locator {
    return this.page.getByRole("table", { name: "Attendance records" });
  }

  row(text: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  filter(label: "Class" | "Section" | "Status" | "Locked"): Locator {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** What an import-only holder (no view key) sees in place of the table. */
  get importOnlyNote(): Locator {
    return this.page.getByText("Attendance import", { exact: true });
  }

  /** The toolbar's Import, shown to a holder of `attendance.student-attendance.import`. */
  get importButton(): Locator {
    return this.page.getByRole("button", { name: "Import", exact: true });
  }

  get importDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Import attendance history" });
  }

  get importSession(): Locator {
    return this.importDialog.getByRole("combobox", { name: "Academic session" });
  }

  get importFileInput(): Locator {
    return this.importDialog.getByLabel("File");
  }

  get importSubmit(): Locator {
    return this.importDialog.getByRole("button", { name: "Upload" });
  }

  /** A finished import's summary badge ("1 imported", "1 failed"). */
  importSummary(text: string): Locator {
    return this.importDialog.getByText(text, { exact: true });
  }

  /** The error table's row for one issue: its row number, field and sentence. */
  importErrorRow(issue: string): Locator {
    return this.importDialog.getByRole("row").filter({ hasText: issue });
  }

  /** Narrows the list to one class's section. */
  async filterToSection(className: string, sectionName: string): Promise<void> {
    await this.filter("Class").click();
    await this.option(className).click();
    await this.filter("Section").click();
    await this.option(sectionName).click();
  }
}
