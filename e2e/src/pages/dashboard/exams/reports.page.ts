import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/reports` — the "Report options" form (Report, Exam, Run report), then the report as a
 * "{Kind} report" table, or, past 1,000 rows, a job panel. See
 * `apps/dashboard/src/features/exams/reports/`.
 */
export class ExamReportsPage extends BasePage {
  readonly path = "/exams/reports";

  get form(): Locator {
    return this.page.getByRole("form", { name: "Report options" });
  }

  picker(label: "Report" | "Exam"): Locator {
    return this.form.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** Picks `name` ("Result register", or an exam's "{name} · {session}") in `label`'s picker. */
  async pick(label: "Report" | "Exam", name: string): Promise<void> {
    await this.picker(label).click();
    await this.option(name).click();
  }

  get run(): Locator {
    return this.form.getByRole("button", { name: "Run report", exact: true });
  }

  /** The report on screen, named by its kind ("Result register"). */
  table(kind: string): Locator {
    return this.page.getByRole("table", { name: `${kind} report` });
  }

  row(kind: string, text: string | RegExp): Locator {
    return this.table(kind).getByRole("row").filter({ hasText: text });
  }
}
