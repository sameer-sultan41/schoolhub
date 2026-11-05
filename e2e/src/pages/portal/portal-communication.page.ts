import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * The portal's communication pages: `/portal/notices` (and one notice), `/portal/notifications`
 * (the inbox) and `/portal/settings` (the preference matrix). Reached through the shell's tabs
 * (`PortalPage.tab`). See `apps/dashboard/src/features/portal/{notices,notifications,preferences}/`.
 */
export class PortalCommunicationPage extends BasePage {
  readonly path = "/portal";

  // ---- notices ----------------------------------------------------------------------------

  notice(title: string): Locator {
    return this.page.getByRole("link", { name: title, exact: true });
  }

  /** The list's flag on a notice that still needs the guardian's acknowledgment. */
  get needsAcknowledgment(): Locator {
    return this.page.getByText("Acknowledgment needed", { exact: true });
  }

  get acknowledge(): Locator {
    return this.page.getByRole("button", { name: "Acknowledge", exact: true });
  }

  get acknowledged(): Locator {
    return this.page.getByText("Acknowledged", { exact: true });
  }

  get backToNotices(): Locator {
    return this.page.getByRole("link", { name: "Back to notices", exact: true });
  }

  // ---- inbox ------------------------------------------------------------------------------

  /** A notification's row (the button that opens it), found by its title. */
  notification(title: string): Locator {
    return this.page.getByRole("button").filter({ hasText: title });
  }

  /** The "Unread" badge inside a notification's row. */
  unreadFlag(row: Locator): Locator {
    return row.getByText("Unread", { exact: true });
  }

  get markAllRead(): Locator {
    return this.page.getByRole("button", { name: "Mark all read", exact: true });
  }

  // ---- settings ---------------------------------------------------------------------------

  /** One cell of the matrix, named "{category} by {channel}", e.g. "Fees by SMS". */
  preference(category: string, channel: string): Locator {
    return this.page.getByRole("checkbox", { name: `${category} by ${channel}`, exact: true });
  }
}
