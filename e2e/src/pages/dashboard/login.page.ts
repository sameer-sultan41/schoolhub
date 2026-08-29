import type { Locator } from "@playwright/test";
import type { LoginCredentials } from "@schoolhub/types";
import { BasePage } from "../base.page";

/**
 * `/login` — see `apps/dashboard/src/features/auth/login-form.tsx`.
 *
 * Locators go through accessible names, so a class rename cannot break the suite and a
 * broken label *will*. The names come from `apps/dashboard/messages/en.json`.
 */
export class LoginPage extends BasePage {
  readonly path = "/login";

  get identifier(): Locator {
    return this.page.getByLabel("Email, phone, or username");
  }

  get password(): Locator {
    return this.page.getByLabel("Password", { exact: true });
  }

  get submit(): Locator {
    return this.page.getByRole("button", { name: /sign in|signing in/i });
  }

  async fill(credentials: LoginCredentials): Promise<void> {
    await this.identifier.fill(credentials.identifier);
    await this.password.fill(credentials.password);
  }

  async signIn(credentials: LoginCredentials): Promise<void> {
    await this.fill(credentials);
    await this.submit.click();
  }

  /**
   * An error message shown to the user.
   *
   * `FormField` renders per-field validation messages with `role="alert"` too, so the
   * card-level API error is scoped by its text rather than matched by role alone —
   * otherwise a form with both would be a strict-mode violation.
   */
  error(message: string | RegExp): Locator {
    return this.page.getByRole("alert").filter({ hasText: message });
  }
}
