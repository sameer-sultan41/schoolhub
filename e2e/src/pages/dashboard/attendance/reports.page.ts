import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

type ExportFormat = "CSV" | "XLSX" | "PDF";

/**
 * `/attendance/reports` — the "Report options" form (Report, its date or range, Class and
 * Section, a Period for the daily register, "Below (%)" for defaulters, Run report), then the
 * report as a "{Kind} report" table with an "Export the report" group (Export CSV, XLSX, PDF),
 * or, past 1,000 rows, a job panel with Download CSV. See
 * `apps/dashboard/src/features/attendance/reports/`.
 */
export class AttendanceReportsPage extends BasePage {
  readonly path = "/attendance/reports";

  get form(): Locator {
    return this.page.getByRole("form", { name: "Report options" });
  }

  picker(label: "Report" | "Class" | "Section" | "Period"): Locator {
    return this.form.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** Picks one of the six reports by its name ("Defaulters"). */
  async pickReport(name: string): Promise<void> {
    await this.picker("Report").click();
    await this.option(name).click();
  }

  get threshold(): Locator {
    return this.form.getByLabel("Below (%)", { exact: true });
  }

  get run(): Locator {
    return this.form.getByRole("button", { name: "Run report", exact: true });
  }

  /** The report on screen, named by its kind ("Defaulters"). */
  table(kind: string): Locator {
    return this.page.getByRole("table", { name: `${kind} report` });
  }

  row(kind: string, text: string | RegExp): Locator {
    return this.table(kind).getByRole("row").filter({ hasText: text });
  }

  exportButton(format: ExportFormat): Locator {
    return this.page
      .getByRole("group", { name: "Export the report" })
      .getByRole("button", { name: `Export ${format}`, exact: true });
  }
}
