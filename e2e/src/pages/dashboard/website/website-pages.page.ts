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

  /** The selected section's editor: a fieldset named by its legend, the section's type. */
  sectionEditor(type: string): Locator {
    return this.page.getByRole("group", { name: type, exact: true });
  }

  /** An input of the selected section, by its exact label: "Heading" alone would also match
   * "Subheading" (`getByLabel` matches a substring by default). */
  sectionField(type: string, label: string): Locator {
    return this.sectionEditor(type).getByLabel(label, { exact: true });
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

  /**
   * Moves a section by keyboard: Space on its handle, one arrow key per step, Space to drop.
   * `overPositions` names the position each step lands on.
   *
   * Waits for each step's live-region announcement before the next key. dnd-kit's
   * `KeyboardSensor` renders the drag (`aria-pressed`) and adds its keydown listener in a
   * `setTimeout`, which Chrome runs after a queued key; a `setTimeout(0)` of our own, queued
   * behind it, fires only once the listener is in place (lesson L14, `WeekGridPage`).
   */
  async keyboardMoveSection(
    position: number,
    steps: readonly { key: "ArrowUp" | "ArrowDown"; overPosition: number }[],
  ): Promise<void> {
    await this.page
      .getByRole("button", { name: `Drag section ${position} to reorder`, exact: true })
      .focus();
    await this.page.keyboard.press("Space");
    await this.page
      .locator('[aria-roledescription="sortable section"][aria-pressed="true"]')
      .waitFor();
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }),
    );
    for (const step of steps) {
      await this.page.keyboard.press(step.key);
      await this.page
        .getByText(`Section ${position} is over position ${step.overPosition}.`, { exact: true })
        .waitFor({ state: "attached" });
    }
    await this.page.keyboard.press("Space");
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
