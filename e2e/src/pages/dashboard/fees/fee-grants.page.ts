import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/grants`: the Discounts, Scholarships and Fines sub-tabs (`?tab=`), each a table named by
 * its caption with its create button, row actions and dialogs. See
 * `apps/dashboard/src/features/fees/grants/`.
 */
export class FeeGrantsPage extends BasePage {
  readonly path = "/fees/grants";

  async gotoTab(tab: "scholarships" | "fines"): Promise<void> {
    await this.goto({ path: `${this.path}?tab=${tab}` });
  }

  /** A tab's table, named by its caption ("Discounts", "Scholarships", "Fines"). */
  table(caption: string): Locator {
    return this.page.getByRole("table", { name: caption, exact: true });
  }

  row(caption: string, text: string | RegExp): Locator {
    return this.table(caption).getByRole("row").filter({ hasText: text });
  }

  tab(name: string): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  button(name: string | RegExp): Locator {
    return this.page.getByRole("button", { name });
  }

  /** A dialog, by its title. */
  dialog(title: string | RegExp): Locator {
    return this.page.getByRole("dialog", { name: title, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** Picks a student through the form's searchable picker: open it, search, choose the match. */
  async pickStudent(dialog: Locator, search: string, name: string): Promise<void> {
    await dialog.getByRole("button", { name: "Choose a student", exact: true }).click();
    await this.page.getByRole("textbox", { name: "Search students", exact: true }).fill(search);
    await this.page.getByRole("button", { name }).click();
  }
}
