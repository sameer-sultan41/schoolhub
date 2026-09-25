import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/** `/dashboard` — the authenticated landing page and its permission-filtered navigation. */
export class DashboardPage extends BasePage {
  readonly path = "/dashboard";

  get nav(): Locator {
    return this.page.getByRole("navigation", { name: "Primary navigation" });
  }

  /**
   * The desktop sidebar rail specifically, by its own `data-testid`.
   *
   * Not `nav`: that locator's name is `t("nav.primary")`, which is itself translated —
   * fine for an English-locale test, useless for one that renders under `ur`. And a bare
   * `getByRole("navigation")` strict-mode-violates here regardless of locale, because the
   * footer and the header breadcrumb are both real, separately-named `nav` landmarks on
   * this page too. This is the one control on the page whose testid exists purely to give
   * a locale-independent test something unambiguous to grab.
   */
  get desktopSidebar(): Locator {
    return this.page.getByTestId("app-sidebar-nav");
  }

  /**
   * A navigation entry by its visible label, e.g. `navLink("Fees & Finance")`.
   *
   * Deliberately a link and nothing else: a module with no route yet renders as a disabled
   * button instead, so a `toHaveCount(0)` here still means "there is nothing to click"
   * without this locator having to know which modules are built.
   */
  navLink(name: string): Locator {
    return this.nav.getByRole("link", { name });
  }

  /**
   * The avatar trigger in the header; the account menu hangs off it.
   *
   * By testid, not role+name: the Avatar (user-dropdown-menu.tsx) carries no accessible
   * name or button role of its own — Radix's DropdownMenuTrigger asChild composition
   * doesn't synthesize one, so it shows up in the accessibility tree as a nameless
   * generic element (confirmed against a real CI accessibility snapshot). A prior
   * getByRole("button", { name: "Account" }) here didn't fail loudly; it silently
   * matched an unrelated "Account" link nested in the sidebar's own "My Account"
   * accordion instead, which is worse than a locator that can't find anything. The
   * trigger's own testid ("user-menu-trigger") already exists in the source for exactly
   * this reason. The underlying gap — this control has no accessible name at all — is
   * itself worth filing as an accessibility bug.
   */
  get userMenu(): Locator {
    return this.page.getByTestId("user-menu-trigger");
  }

  /**
   * Opens the account menu and hands back the sign-out item.
   *
   * Sign-out lives inside a dropdown now, so the control does not exist in the DOM until
   * the menu opens — returning the locator from the action keeps a spec from reaching for
   * something that is not there yet.
   */
  async openUserMenu(): Promise<Locator> {
    await this.userMenu.click();
    // A plain button in the panel's footer, not a menuitem — the trigger's own name is
    // "Logout" (user-dropdown-menu.tsx), not "Sign out".
    return this.page.getByRole("button", { name: "Logout" });
  }

  /**
   * Banner shown while a support user is impersonating this account.
   *
   * Matched by name, not by role alone: the shell may hold more than one live region, and
   * a bare `getByRole("status")` would then fail Playwright's strict mode rather than
   * failing on the behaviour the spec cares about. The name is the banner's own short
   * `auth.session.impersonatingLabel`, deliberately separate from the sentence it
   * contains — a live region named after its own content is announced twice.
   */
  get impersonationNotice(): Locator {
    return this.page.getByRole("status", { name: /impersonation/i });
  }
}
