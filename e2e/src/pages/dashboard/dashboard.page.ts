import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/** `/dashboard` — the authenticated landing page and its permission-filtered navigation. */
export class DashboardPage extends BasePage {
  readonly path = "/dashboard";

  get nav(): Locator {
    return this.page.getByRole("navigation", { name: "Primary navigation" });
  }

  /** A navigation entry by its visible label, e.g. `navLink("Fees & Finance")`. */
  navLink(name: string): Locator {
    return this.nav.getByRole("link", { name });
  }

  get signOut(): Locator {
    return this.page.getByRole("button", { name: "Sign out" });
  }

  /** Banner shown while a support user is impersonating this account. */
  get impersonationNotice(): Locator {
    return this.page.getByRole("status");
  }
}
