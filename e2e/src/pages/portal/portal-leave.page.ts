import type { Locator, Page } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * A child's leave page (`/portal/{studentId}/leave`): the list, the new-request dialog and a
 * request's Cancel. Reached through the shell's tab (`PortalPage.tab`). Names come from
 * `apps/dashboard/messages/en.json` (`portal.leave`).
 */
export class PortalLeavePage extends BasePage {
  readonly path = "/portal";

  // ---- the list -----------------------------------------------------------------------------

  /** One request's row, found by its reason. */
  request(reason: string): Locator {
    return this.page.getByRole("listitem").filter({ hasText: reason });
  }

  get newRequest(): Locator {
    return this.page.getByRole("button", { name: "New request", exact: true });
  }

  /** A row's Cancel button, or the one in the confirm dialog when `within` is the dialog. */
  cancelButton(within: Page | Locator = this.page): Locator {
    return within.getByRole("button", { name: "Cancel request", exact: true });
  }

  /** A row's attached-document download; its name carries the leave type and dates. */
  attachmentDownload(row: Locator): Locator {
    return row.getByRole("button", { name: /^Download the .+ note/ });
  }

  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  // ---- the new-request dialog ---------------------------------------------------------------

  get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  get typeSelect(): Locator {
    return this.dialog.getByRole("combobox", { name: "Leave type", exact: true });
  }

  get from(): Locator {
    return this.dialog.getByLabel("From", { exact: true });
  }

  get to(): Locator {
    return this.dialog.getByLabel("To", { exact: true });
  }

  get reason(): Locator {
    return this.dialog.getByLabel("Reason", { exact: true });
  }

  get attachment(): Locator {
    return this.dialog.getByLabel("Supporting document (PDF, JPEG or PNG)", { exact: true });
  }

  get submit(): Locator {
    return this.dialog.getByRole("button", { name: "Submit request", exact: true });
  }
}
