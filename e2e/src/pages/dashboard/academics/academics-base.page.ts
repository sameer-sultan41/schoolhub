import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * Base for the Academics screens. Their selects are Radix `Select`s: the trigger is a
 * `combobox`, and its options render in a portal outside any dialog, hence the page-level
 * lookup. (`BasePage` is not the home: `StaffPage`, `StudentDetailPage` and `WeekGridPage`
 * already have a different `chooseOption`.)
 */
export abstract class AcademicsPage extends BasePage {
  /** An option of an open select; exact, so "Draft" never also picks a longer name. */
  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  async chooseOption(trigger: Locator, option: string): Promise<void> {
    await trigger.click();
    await this.option(option).click();
  }
}
