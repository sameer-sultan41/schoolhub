import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/fees/structures` and a structure's own page (`/fees/structures/{id}`): the Structures and Fee
 * heads tabs with their tables (each structure name a link to its page), the "New fee structure"
 * and "New fee head" buttons, and a structure's header actions (Activate, Archive, Edit, Delete),
 * its Schedules table and "Add schedule". See `apps/dashboard/src/features/fees/structures/` and
 * `.../heads/`.
 */
export class FeeStructuresPage extends BasePage {
  readonly path = "/fees/structures";

  async gotoStructure(structureId: string): Promise<void> {
    await this.goto({ path: `${this.path}/${structureId}` });
  }

  /** A sub-tab of the page, "Structures" or "Fee heads". */
  tab(name: "Structures" | "Fee heads"): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  /** Named by its caption (`structures.list.caption`). */
  get structuresTable(): Locator {
    return this.page.getByRole("table", { name: "Fee structures", exact: true });
  }

  structureRow(name: string | RegExp): Locator {
    return this.structuresTable.getByRole("row").filter({ hasText: name });
  }

  structureLink(name: string): Locator {
    return this.structuresTable.getByRole("link", { name, exact: true });
  }

  get createStructureButton(): Locator {
    return this.page.getByRole("button", { name: "New fee structure", exact: true });
  }

  /** Named by its caption (`heads.list.caption`). */
  get headsTable(): Locator {
    return this.page.getByRole("table", { name: "Fee heads", exact: true });
  }

  headRow(name: string | RegExp): Locator {
    return this.headsTable.getByRole("row").filter({ hasText: name });
  }

  get createHeadButton(): Locator {
    return this.page.getByRole("button", { name: "New fee head", exact: true });
  }

  headAction(name: string, action: "Edit" | "Delete"): Locator {
    return this.page.getByRole("button", { name: `${action} ${name}`, exact: true });
  }

  /** A form dialog, by its title. */
  dialog(title: string): Locator {
    return this.page.getByRole("dialog", { name: title, exact: true });
  }

  /** A confirm (activate, archive, delete); its confirm repeats the header button's label. */
  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  /** A select's option; options render in a portal, outside the dialog. */
  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  headerAction(name: "Activate" | "Archive" | "Edit" | "Delete"): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }

  get addScheduleButton(): Locator {
    return this.page.getByRole("button", { name: "Add schedule", exact: true });
  }

  /** Named by its caption (`structures.schedules.caption`). */
  get schedulesTable(): Locator {
    return this.page.getByRole("table", { name: "Fee schedules of this structure", exact: true });
  }

  scheduleRow(name: string | RegExp): Locator {
    return this.schedulesTable.getByRole("row").filter({ hasText: name });
  }
}
