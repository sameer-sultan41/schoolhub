import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/mfa/verify` and `/platform/*`: the second-factor step, the tenants list, a tenant's detail
 * page and its lifecycle dialogs. See `apps/dashboard/src/features/auth/mfa-verify-form.tsx`
 * and `apps/dashboard/src/features/platform/`. Names come from `messages/en.json`.
 */
export class PlatformConsolePage extends BasePage {
  readonly path = "/platform/tenants";

  get mfaCode(): Locator {
    return this.page.getByRole("textbox", { name: "Authentication code", exact: true });
  }

  get mfaSubmit(): Locator {
    return this.page.getByRole("button", { name: /^verify$|verifying/i });
  }

  get table(): Locator {
    return this.page.getByRole("table");
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get newSchool(): Locator {
    return this.page.getByRole("button", { name: "New school" });
  }

  get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  field(name: string): Locator {
    return this.dialog.getByRole("textbox", { name, exact: true });
  }

  /** The tenant detail page's lifecycle action, by its button label. */
  action(name: string): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }

  /** The status badge in the tenant detail page's header. */
  get status(): Locator {
    return this.page.getByRole("status", { name: "School status" });
  }
}
