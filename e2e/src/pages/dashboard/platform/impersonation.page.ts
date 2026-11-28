import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * The impersonation flow (ADR-0037): the console's "Impersonate user" dialog, the handoff page on
 * the school's host (`/impersonate`) and the banner an impersonated session shows. See
 * `apps/dashboard/src/features/platform/impersonation/`, `features/auth/impersonation-handoff.tsx`
 * and `components/impersonation-banner.tsx`. Names come from `messages/en.json`.
 */
export class ImpersonationPage extends BasePage {
  readonly path = "/impersonate";

  /** The tenant detail page's action that opens the dialog. */
  get impersonateUser(): Locator {
    return this.page.getByRole("button", { name: "Impersonate user", exact: true });
  }

  get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  get userPicker(): Locator {
    return this.dialog.getByRole("combobox", { name: "User" });
  }

  get reason(): Locator {
    return this.dialog.getByRole("textbox", { name: /reason/i });
  }

  get startSession(): Locator {
    return this.dialog.getByRole("button", { name: "Start session" });
  }

  /** The started grant's link to the school's dashboard, opened in a new tab. */
  get openDashboard(): Locator {
    return this.dialog.getByRole("link", { name: /dashboard/i });
  }

  /** The persistent banner of an impersonated session. */
  get banner(): Locator {
    return this.page.getByRole("region", { name: "Support session" });
  }

  get endSession(): Locator {
    return this.banner.getByRole("button", { name: "End session" });
  }
}
