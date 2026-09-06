import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * `/staff` list, `/staff/new` create form, and `/staff/:id` detail — see
 * `apps/dashboard/src/features/staff/`.
 *
 * Locators go through accessible names, sourced from
 * `apps/dashboard/messages/en.json`'s `staff` namespace — same convention as
 * `LoginPage`.
 */
export class StaffPage extends BasePage {
  readonly path = "/staff";

  get table(): Locator {
    return this.page.getByRole("table");
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get createLink(): Locator {
    return this.page.getByRole("link", { name: "New staff member" });
  }

  get searchInput(): Locator {
    return this.page.getByLabel("Search");
  }

  // ---- Table controls ----
  //
  // These live inside the table's own card now — the filter row, the header and the
  // pager share one border — but each is still reached by its accessible name, so the
  // reframing is invisible from here. That is the point of pinning names, not structure.

  /** A column header's sort control. Its name says what pressing it will DO. */
  sortBy(column: string): Locator {
    return this.page.getByRole("button", { name: new RegExp(`sort by ${column}`, "i") });
  }

  get columnsMenuTrigger(): Locator {
    return this.page.getByRole("button", { name: "Columns" });
  }

  /** One row of the show/hide menu. Ticked means the column is visible. */
  columnToggle(column: string): Locator {
    return this.page.getByRole("menuitemcheckbox", { name: column });
  }

  get columnHeaders(): Locator {
    return this.table.getByRole("columnheader");
  }

  /** A numbered page button — `common.goToPage` names it "Go to page N". */
  pageButton(page: number): Locator {
    return this.page.getByRole("button", { name: `Go to page ${String(page)}` });
  }

  get nextPage(): Locator {
    return this.page.getByRole("button", { name: "Next page" });
  }

  get previousPage(): Locator {
    return this.page.getByRole("button", { name: "Previous page" });
  }

  // ---- Create/edit form ----

  // getByRole, not getByLabel — see LoginPage's identical comment: FormField renders
  // the required marker as an aria-hidden sibling of the label text, which breaks
  // getByLabel's text-based match but not getByRole's accessible-name computation.
  // Confirmed live: getByLabel("First name") times out against the real page even
  // though the input's own computed accessible name is exactly "First name".
  get firstName(): Locator {
    return this.page.getByRole("textbox", { name: "First name", exact: true });
  }

  get lastName(): Locator {
    return this.page.getByRole("textbox", { name: "Last name", exact: true });
  }

  get phone(): Locator {
    return this.page.getByRole("textbox", { name: "Phone", exact: true });
  }

  get joiningDate(): Locator {
    return this.page.getByRole("textbox", { name: "Joining date", exact: true });
  }

  /** Select triggers render as `combobox` with the field label as their accessible name. */
  select(fieldLabel: string): Locator {
    return this.page.getByRole("combobox", { name: fieldLabel });
  }

  async chooseOption(fieldLabel: string, optionName: string | RegExp): Promise<void> {
    await this.select(fieldLabel).click();
    await this.page.getByRole("option", { name: optionName }).click();
  }

  get submit(): Locator {
    return this.page.getByRole("button", { name: "New staff member" });
  }

  async fillRequiredFields(values: {
    firstName: string;
    lastName: string;
    phone: string;
    joiningDate: string;
    campus: string | RegExp;
  }): Promise<void> {
    await this.firstName.fill(values.firstName);
    await this.lastName.fill(values.lastName);
    await this.phone.fill(values.phone);
    await this.joiningDate.fill(values.joiningDate);
    await this.chooseOption("Campus", values.campus);
  }
}
