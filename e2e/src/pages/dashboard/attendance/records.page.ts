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

  /** Narrows the list to one class's section. */
  async filterToSection(className: string, sectionName: string): Promise<void> {
    await this.filter("Class").click();
    await this.option(className).click();
    await this.filter("Section").click();
    await this.option(sectionName).click();
  }
}
