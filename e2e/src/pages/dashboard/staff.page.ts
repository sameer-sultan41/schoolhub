import type { Locator } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * `/staff` — the directory table plus its two dialogs: Add/Edit (`StaffFormDialog`) and
 * Exit (`ExitStaffDialog`, behind each row's "Delete" action). See
 * `apps/dashboard/src/app/(app)/staff/`.
 *
 * This route's strings are hardcoded English on this branch (no `staff` messages
 * namespace yet — see apps/dashboard/AGENTS.md), so the accessible names below come from
 * those components directly.
 */
export class StaffPage extends BasePage {
  readonly path = "/staff";

  get table(): Locator {
    return this.page.getByRole("table");
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  get searchInput(): Locator {
    return this.page.getByRole("textbox", { name: "Search staff" });
  }

  get addMemberButton(): Locator {
    return this.page.getByRole("button", { name: "Add Member", exact: true });
  }

  /** Opens a row's ⋮ menu and picks `action` ("Edit", "Copy ID" or "Delete"). */
  async rowAction(name: string, action: "Edit" | "Copy ID" | "Delete"): Promise<void> {
    await this.page.getByRole("button", { name: `Actions for ${name}` }).click();
    await this.page.getByRole("menuitem", { name: action }).click();
  }

  // ---- Add/Edit dialog ----

  /** Add and Edit are one dialog; only the title differs. */
  get formDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^(Add|Edit) staff member$/ });
  }

  // getByRole, not getByLabel: FormLabel renders the required marker as an aria-hidden
  // "*" inside the label, which getByLabel's text match includes ("First name*") but
  // getByRole's accessible-name computation correctly drops.
  field(label: string): Locator {
    return this.formDialog.getByRole("textbox", { name: label, exact: true });
  }

  /** Radix Select triggers render as `combobox`, named by their field label. */
  select(label: string): Locator {
    return this.formDialog.getByRole("combobox", { name: label, exact: true });
  }

  /** Options render in a portal outside the dialog, hence the page-level lookup. Exact,
   * because a substring match would make "Teaching" also hit "Non-teaching". */
  async chooseOption(label: string, option: string | RegExp): Promise<void> {
    await this.select(label).click();
    await this.page.getByRole("option", { name: option, exact: true }).click();
  }

  get addSubmit(): Locator {
    return this.formDialog.getByRole("button", { name: "Add member" });
  }

  get saveChanges(): Locator {
    return this.formDialog.getByRole("button", { name: "Save changes" });
  }

  async fillRequiredFields(values: {
    firstName: string;
    lastName: string;
    staffType: string | RegExp;
    campus: string | RegExp;
    joiningDate: string;
    phone: string;
  }): Promise<void> {
    await this.field("First name").fill(values.firstName);
    await this.field("Last name").fill(values.lastName);
    await this.chooseOption("Staff type", values.staffType);
    await this.chooseOption("Campus", values.campus);
    await this.field("Joining date").fill(values.joiningDate);
    await this.field("Phone").fill(values.phone);
  }

  // ---- Exit dialog ----

  get exitDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  exitField(label: "Exit date" | "Exit reason"): Locator {
    return this.exitDialog.getByRole("textbox", { name: label, exact: true });
  }

  get confirmExit(): Locator {
    return this.exitDialog.getByRole("button", { name: /^Exit staff members?$/ });
  }
}
