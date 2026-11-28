import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * The site-wide Website screens: `/website/settings`, `/website/navigation`, `/website/domains`
 * and `/website/inbox`. A menu's links are listed items named "Link {n}: {label}", a sub-link
 * "Sub-link {n} of link {parent}"; a domain is a region named by its address. See
 * `apps/dashboard/src/features/website/{settings,navigation,domains,inbox}/`.
 */
export class WebsiteSitePage extends BasePage {
  readonly path = "/website/settings";

  async gotoNavigation(): Promise<void> {
    await this.goto({ path: "/website/navigation" });
  }

  async gotoDomains(): Promise<void> {
    await this.goto({ path: "/website/domains" });
  }

  async gotoInbox(query = ""): Promise<void> {
    await this.goto({ path: `/website/inbox${query}` });
  }

  /** A menu's tab: "Header", "Footer" or "Footer, second row". */
  menuTab(name: string): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  /** The visible menu's top-level link at `position`. */
  menuLink(position: number, label: string): Locator {
    return this.page.getByRole("listitem", { name: `Link ${position}: ${label}`, exact: true });
  }

  subLinks(parentLabel: string): Locator {
    return this.page
      .getByRole("list", { name: `Sub-links of ${parentLabel}`, exact: true })
      .getByRole("listitem");
  }

  subLink(position: number, parent: number): Locator {
    return this.page.getByRole("listitem", {
      name: `Sub-link ${position} of link ${parent}`,
      exact: true,
    });
  }

  subLinkHandle(position: number, parent: number): Locator {
    return this.page.getByRole("button", {
      name: `Drag sub-link ${position} of link ${parent}`,
      exact: true,
    });
  }

  /**
   * Drags `handle` onto `target` with the mouse, in small steps: dnd-kit's pointer sensor waits
   * for 4 px of travel before a drag starts, and sorts on the moves that follow.
   */
  async dragOnto(handle: Locator, target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("drag handle or target is not on screen");
    const x = from.x + from.width / 2;
    await this.page.mouse.move(x, from.y + from.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(x, from.y + from.height / 2 - 10, { steps: 5 });
    await this.page.mouse.move(x, to.y + 4, { steps: 15 });
    await this.page.mouse.up();
  }

  /** A domain's card, by its address. */
  domain(name: string): Locator {
    return this.page.getByRole("region", { name, exact: true });
  }

  get inboxTable(): Locator {
    return this.page.getByRole("table", { name: "Contact messages", exact: true });
  }

  inboxRow(sender: string): Locator {
    return this.inboxTable.getByRole("row").filter({ hasText: sender });
  }

  /** The open dialog, sheet or alert dialog, by its title. */
  dialog(name: string): Locator {
    return this.page.getByRole("dialog", { name, exact: true });
  }

  alertDialog(name: string): Locator {
    return this.page.getByRole("alertdialog", { name, exact: true });
  }
}
