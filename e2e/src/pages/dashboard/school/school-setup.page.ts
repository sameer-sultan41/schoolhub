import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/** The School module's sections, by their tab label and path. */
export const SCHOOL_SECTION_PATHS = {
  "Profile & settings": "/school/profile",
  Campuses: "/school/campuses",
  Departments: "/school/departments",
  Houses: "/school/houses",
  Calendar: "/school/calendar",
} as const;

export type SchoolSection = keyof typeof SCHOOL_SECTION_PATHS;

/**
 * `/school/*` — the School module's tabs, each section's list with its per-row Edit and Remove
 * buttons, the toolbar's Add button, and the create/edit and remove dialogs. See
 * `apps/dashboard/src/features/school/`.
 */
export class SchoolSetupPage extends BasePage {
  readonly path = "/school";

  async open(section: SchoolSection): Promise<void> {
    await this.goto({ path: SCHOOL_SECTION_PATHS[section] });
  }

  get tabs(): Locator {
    return this.page.getByRole("navigation", { name: "School sections" });
  }

  tab(section: SchoolSection): Locator {
    return this.tabs.getByRole("link", { name: section, exact: true });
  }

  get table(): Locator {
    return this.page.getByRole("table");
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  /** The toolbar's or a card's Add button, e.g. "Add campus", "Add holiday". */
  addButton(label: string): Locator {
    return this.page.getByRole("button", { name: label, exact: true });
  }

  /** A row's Edit or Remove button, named "{Action} {name}". */
  rowAction(name: string, action: "Edit" | "Remove"): Locator {
    return this.page.getByRole("button", { name: `${action} ${name}`, exact: true });
  }

  get formDialog(): Locator {
    return this.page.getByRole("dialog");
  }

  field(label: string): Locator {
    return this.formDialog.getByLabel(label, { exact: true });
  }

  formSelect(label: string): Locator {
    return this.formDialog.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  get saveButton(): Locator {
    return this.formDialog.getByRole("button", { name: "Save", exact: true });
  }

  get removeDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  get confirmRemove(): Locator {
    return this.removeDialog.getByRole("button", { name: "Remove", exact: true });
  }

  /** A page-level form input (the profile form is not in a dialog). */
  pageField(label: string): Locator {
    return this.page.getByLabel(label, { exact: true });
  }

  /** A working-day toggle, by its full weekday name. */
  weekday(day: string): Locator {
    return this.page.getByRole("button", { name: day, exact: true });
  }

  button(name: string): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }
}
