import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/setup` — the onboarding wizard: its step list, the open step's own actions (confirm, skip,
 * previous, next, a linked step's link) and the home page's "Finish setting up" card. The
 * embedded School sections are driven through `SchoolSetupPage`. See
 * `apps/dashboard/src/features/onboarding/`.
 */
export class SetupWizardPage extends BasePage {
  readonly path = "/setup";

  async openStep(key: string): Promise<void> {
    await this.goto({ path: `${this.path}?step=${key}` });
  }

  get stepList(): Locator {
    return this.page.getByRole("navigation", { name: "Setup steps" });
  }

  /** A step in the list, by its title (its accessible name starts with it). */
  step(title: string): Locator {
    return this.stepList.getByRole("button", { name: new RegExp(`^${title}`) });
  }

  button(name: string): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }

  link(name: string): Locator {
    return this.page.getByRole("link", { name, exact: true });
  }

  /** The home page's card, by its title. */
  get card(): Locator {
    return this.page.getByText("Finish setting up", { exact: true });
  }
}
