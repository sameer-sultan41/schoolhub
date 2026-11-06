import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * A child's leave page (`/portal/{studentId}/leave`) and the portal's write-side controls that
 * sit beside it: the new-request dialog, a request's Cancel, and the fees page's vouchers. Reached
 * through the shell's tab (`PortalPage.tab`). Names come from `apps/dashboard/messages/en.json`
 * (`portal.leave`, `portal.fees.vouchers`).
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
  cancelButton(within: Locator = this.page): Locator {
    return within.getByRole("button", { name: "Cancel request", exact: true });
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

  // ---- fees: vouchers -----------------------------------------------------------------------

  voucherButton(consumerNumber: string): Locator {
    return this.page.getByRole("button", { name: new RegExp(`voucher ${consumerNumber}`) });
  }

  get noVoucher(): Locator {
    return this.page.getByText("Ask the school office for a voucher.", { exact: true });
  }

  // ---- settings: change password ------------------------------------------------------------

  get currentPassword(): Locator {
    return this.page.getByLabel("Current password", { exact: true });
  }

  get newPassword(): Locator {
    return this.page.getByLabel("New password", { exact: true });
  }

  get confirmPassword(): Locator {
    return this.page.getByLabel("Confirm new password", { exact: true });
  }

  get changePassword(): Locator {
    return this.page.getByRole("button", { name: "Change password", exact: true });
  }
}
