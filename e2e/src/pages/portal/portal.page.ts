import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

export type PortalTab =
  | "Overview"
  | "Attendance"
  | "Fees"
  | "Results"
  | "Timetable"
  | "Messages"
  | "Notices"
  | "Notifications"
  | "Settings";

/**
 * `/portal` — the guardian's home, and the shell every portal page shares: the "Portal sections"
 * tab bar (only the tabs the summary's `modules` open), the "Child" switcher (two or more
 * children), the unread badge and Sign out. See `apps/dashboard/src/features/portal/shell/` and
 * `.../home/`. The names come from `apps/dashboard/messages/en.json` (`portal.*`).
 */
export class PortalPage extends BasePage {
  readonly path = "/portal";

  get nav(): Locator {
    return this.page.getByRole("navigation", { name: "Portal sections", exact: true });
  }

  tab(name: PortalTab): Locator {
    return this.nav.getByRole("link", { name, exact: true });
  }

  get switcher(): Locator {
    return this.page.getByRole("combobox", { name: "Child", exact: true });
  }

  /** Picks a child in the switcher; its listbox renders in a portal, so the option is page-level. */
  async chooseChild(name: string): Promise<void> {
    await this.switcher.click();
    await this.page.getByRole("option", { name, exact: true }).click();
  }

  /** A child's card on the home page, or the one card of the overview, found by the child's name. */
  childCard(name: string): Locator {
    return this.page.getByRole("heading", { level: 2, name, exact: true });
  }

  /** The shell's badge, "2 unread notifications". */
  get unreadBadge(): Locator {
    return this.page.getByText(/^\d+ unread notifications?$/);
  }

  get signOut(): Locator {
    return this.page.getByRole("button", { name: "Sign out", exact: true });
  }
}
