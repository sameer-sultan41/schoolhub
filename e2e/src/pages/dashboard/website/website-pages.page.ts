import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/website/pages` and a page's editor (`/website/pages/{id}`): the pages table (each title a
 * link to its editor), "New page" with its details dialog, and the editor's section list (each
 * row named "Section {n}: {type}"), "Add section" menu, Save, Preview and the publish actions.
 * See `apps/dashboard/src/features/website/pages/`.
 */
export class WebsitePagesPage extends BasePage {
  readonly path = "/website/pages";

  async gotoPage(pageId: string): Promise<void> {
    await this.goto({ path: `${this.path}/${pageId}` });
  }

  /** Named by its caption (`website.pages.list.caption`). */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Website pages", exact: true });
  }

  row(title: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: title });
  }

  pageLink(title: string): Locator {
    return this.table.getByRole("link", { name: title, exact: true });
  }

  filter(name: "Status" | "Page type"): Locator {
    return this.page.getByRole("combobox", { name, exact: true });
  }

  get createButton(): Locator {
    return this.page.getByRole("button", { name: "New page", exact: true });
  }

  /** The details dialog, new or edit. */
  get detailsDialog(): Locator {
    return this.page.getByRole("dialog");
  }

  /** The editor's section list, in order. */
  get sectionRows(): Locator {
    return this.page.getByRole("list", { name: "Sections", exact: true }).getByRole("listitem");
  }

  get addSectionButton(): Locator {
    return this.page.getByRole("button", { name: "Add section", exact: true });
  }

  sectionType(name: string): Locator {
    return this.page.getByRole("menuitem", { name, exact: true });
  }

  moveDown(position: number): Locator {
    return this.page.getByRole("button", { name: `Move section ${position} down`, exact: true });
  }

  get saveSectionsButton(): Locator {
    return this.page.getByRole("button", { name: "Save sections", exact: true });
  }

  get previewButton(): Locator {
    return this.page.getByRole("button", { name: "Preview", exact: true });
  }

  get publishButton(): Locator {
    return this.page.getByRole("button", { name: "Publish", exact: true });
  }

  get deleteButton(): Locator {
    return this.page.getByRole("button", { name: "Delete page", exact: true });
  }

  /** The delete confirm; its "Delete page" repeats the header's, so it is reached through this. */
  get deleteDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }
}
