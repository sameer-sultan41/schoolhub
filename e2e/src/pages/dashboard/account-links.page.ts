import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * The unauthenticated account pages (ADR-0033) — `apps/dashboard/src/features/auth/`'s
 * accept-invite, forgot-password and reset-password forms. An emailed link carries its
 * values in the fragment, so `openLink` takes the whole `#school=…&token=…` suffix.
 *
 * Password inputs are found by role, as `LoginPage` does: the required marker is an
 * aria-hidden sibling of the label text, which `getByLabel` would not exclude.
 */
abstract class SetPasswordPage extends BasePage {
  get newPassword(): Locator {
    return this.page.getByRole("textbox", { name: "New password", exact: true });
  }

  get confirmPassword(): Locator {
    return this.page.getByRole("textbox", { name: "Confirm password", exact: true });
  }

  /** The notice an unusable link shows instead of the form. */
  get invalidLink(): Locator {
    return this.page.getByText("This link can't be used");
  }

  async openLink(fragment: string): Promise<void> {
    await this.page.goto(`${this.path}#${fragment}`);
  }

  async choosePassword(password: string, submitName: string): Promise<void> {
    await this.newPassword.fill(password);
    await this.confirmPassword.fill(password);
    await this.page.getByRole("button", { name: submitName }).click();
  }
}

export class AcceptInvitePage extends SetPasswordPage {
  readonly path = "/accept-invite";

  async accept(password: string): Promise<void> {
    await this.choosePassword(password, "Create account");
  }
}

export class ResetPasswordPage extends SetPasswordPage {
  readonly path = "/reset-password";

  async reset(password: string): Promise<void> {
    await this.choosePassword(password, "Save password");
  }
}

export class ForgotPasswordPage extends BasePage {
  readonly path = "/forgot-password";

  get email(): Locator {
    return this.page.getByRole("textbox", { name: "Email", exact: true });
  }

  async requestLink(email: string): Promise<void> {
    await this.email.fill(email);
    await this.page.getByRole("button", { name: "Email me a link" }).click();
  }
}
