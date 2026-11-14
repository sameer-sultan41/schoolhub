import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/reports`: the report form (its kind, dates, grouping and campus, session and class
 * filters), the report's table (named by its caption, `{report} report`), Export CSV, XLSX and
 * PDF, and the "Too large to show" offer. See `apps/dashboard/src/features/fees/reports/`.
 */
export class FeeReportsPage extends BasePage {
  readonly path = "/fees/reports";

  /** A report's table, named by its caption (`reports.caption`: "{report} report"). */
  table(report: string): Locator {
    return this.page.getByRole("table", { name: `${report} report`, exact: true });
  }

  row(report: string, text: string | RegExp): Locator {
    return this.table(report).getByRole("row").filter({ hasText: text });
  }

  /** One of the form's selects (`Report`, `Group by`, `Campus`, `Session`, `Class`). */
  select(name: string): Locator {
    return this.page.getByRole("combobox", { name, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** Picks `option` in the select named `name`. */
  async choose(name: string, option: string): Promise<void> {
    await this.select(name).click();
    await this.option(option).click();
  }

  /** A date input, by its accessible name (`From`, `To`, `As of`). */
  dateInput(name: "From" | "To" | "As of"): Locator {
    return this.page.getByLabel(name, { exact: true });
  }

  exportButton(format: "CSV" | "XLSX" | "PDF"): Locator {
    return this.page.getByRole("button", { name: `Export ${format}`, exact: true });
  }

  /** The offer a report over the inline ceiling shows instead of an error. */
  get tooLarge(): Locator {
    return this.page.getByText("Too large to show — export instead", { exact: true });
  }
}
