import type { Locator, Page } from "@playwright/test";

/**
 * The relation panels a student record shows in two places: the detail sheet's tabs
 * and the creation wizard's later steps. `student-create-stepper.tsx` renders the same
 * `StudentGuardiansTab`, `StudentEmergencyContactsTab` and `StudentEnrollmentTab`
 * (`student-guardians-tab.tsx`, `student-emergency-contacts-tab.tsx`,
 * `student-enrollment-tab.tsx`) that `student-detail-tabs.tsx` does, so their locators
 * live here once, scoped to whichever dialog hosts them (`StudentDetailPage.sheet` or
 * `StudentCreateStepperPage.dialog`). Not a page: it has no route of its own.
 *
 * Every action opens a nested dialog whose title and submit button repeat the trigger's
 * name ("Link guardian", "Add contact", "Enroll", ...). While a Radix dialog is open,
 * every other dialog is `aria-hidden`, the host included, so a nested dialog is found by
 * its own name from the page, never through the host. Each action then waits for that
 * named dialog to close, not for "any dialog" — the host is a dialog too and stays open.
 */
export class StudentRelationsPanel {
  constructor(
    private readonly page: Page,
    private readonly host: Locator,
  ) {}

  private dialog(name: string): Locator {
    return this.page.getByRole("dialog", { name, exact: true });
  }

  private alertDialog(name: string): Locator {
    return this.page.getByRole("alertdialog", { name, exact: true });
  }

  /** A `Select` inside `dialog`. Its listbox renders in a portal, so the option is page-level. */
  private async chooseOption(
    dialog: Locator,
    fieldLabel: string,
    optionName: string | RegExp,
  ): Promise<void> {
    await dialog.getByRole("combobox", { name: fieldLabel, exact: true }).click();
    await this.page.getByRole("option", { name: optionName, exact: true }).click();
  }

  /** A guardian, contact or enrollment line in the host, by its exact text. */
  entry(text: string): Locator {
    return this.host.getByText(text, { exact: true });
  }

  // --- Guardians ---

  get linkGuardianTrigger(): Locator {
    return this.host.getByRole("button", { name: "Link guardian", exact: true });
  }

  /**
   * "Create new" is a tab of the picker (`guardian-picker-body.tsx`). Its own submit,
   * "Create guardian", only creates the record and moves to the link step, where the
   * relationship is chosen before "Link guardian" links it.
   */
  async createAndLinkGuardian(values: {
    firstName: string;
    lastName: string;
    phone: string;
    relationship: string;
  }): Promise<void> {
    await this.linkGuardianTrigger.click();
    const dialog = this.dialog("Link guardian");
    await dialog.getByRole("tab", { name: "Create new", exact: true }).click();
    await dialog.getByLabel("First name", { exact: true }).fill(values.firstName);
    await dialog.getByLabel("Last name", { exact: true }).fill(values.lastName);
    await dialog.getByLabel("Phone", { exact: true }).fill(values.phone);
    await dialog.getByRole("button", { name: "Create guardian", exact: true }).click();
    await this.chooseOption(dialog, "Relationship", values.relationship);
    await dialog.getByRole("button", { name: "Link guardian", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  // --- Emergency contacts ---

  get addContactTrigger(): Locator {
    return this.host.getByRole("button", { name: "Add contact", exact: true });
  }

  async addEmergencyContact(values: {
    name: string;
    relationship: string;
    phone: string;
  }): Promise<void> {
    await this.addContactTrigger.click();
    const dialog = this.dialog("Add contact");
    await dialog.getByLabel("Name", { exact: true }).fill(values.name);
    await dialog.getByLabel("Relationship", { exact: true }).fill(values.relationship);
    await dialog.getByLabel("Phone", { exact: true }).fill(values.phone);
    await dialog.getByRole("button", { name: "Add contact", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  // --- Enrollment ---

  get enrollTrigger(): Locator {
    return this.host.getByRole("button", { name: "Enroll", exact: true });
  }

  async enroll(values: {
    sessionName: string;
    className: string;
    sectionName: string;
    enrollmentDate: string;
  }): Promise<void> {
    await this.enrollTrigger.click();
    const dialog = this.dialog("Enroll");
    await this.chooseOption(dialog, "Academic session", values.sessionName);
    await this.chooseOption(dialog, "Class", values.className);
    await this.chooseOption(dialog, "Section", values.sectionName);
    await dialog.getByLabel("Enrollment date", { exact: true }).fill(values.enrollmentDate);
    await dialog.getByRole("button", { name: "Enroll", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  /**
   * `enrollment.notEnrolled`'s copy, which is gone only once an active enrollment exists.
   * Not the word "Active": the student's status badge and the enrollment's both say it.
   */
  get notEnrolledMessage(): Locator {
    return this.host.getByText("Not enrolled in an active session.", { exact: true });
  }

  // --- Change section ---

  get changeSectionTrigger(): Locator {
    return this.host.getByRole("button", { name: "Change section", exact: true });
  }

  /** The class is a fixed label in this dialog (`change-section-dialog.tsx`), not a Select. */
  async changeSection(values: { sectionName: string | RegExp }): Promise<void> {
    await this.changeSectionTrigger.click();
    const dialog = this.dialog("Change section");
    await this.chooseOption(dialog, "Section", values.sectionName);
    await dialog.getByRole("button", { name: "Change section", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  // --- Transfers ---

  get requestTransferTrigger(): Locator {
    return this.host.getByRole("button", { name: "Request transfer", exact: true });
  }

  /** "Inter-campus" is the dialog's default transfer type, so no radio click is needed. */
  async requestInterCampusTransfer(values: {
    toCampusName: string | RegExp;
    reason: string;
    effectiveDate: string;
  }): Promise<void> {
    await this.requestTransferTrigger.click();
    const dialog = this.dialog("Request transfer");
    await this.chooseOption(dialog, "To campus", values.toCampusName);
    await dialog.getByLabel("Reason", { exact: true }).fill(values.reason);
    await dialog.getByLabel("Effective date", { exact: true }).fill(values.effectiveDate);
    await dialog.getByRole("button", { name: "Request transfer", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  /** A transfer's status badge, e.g. "Requested" (`transfers.status.*`). */
  transferStatus(status: "Requested" | "Approved" | "Rejected" | "Completed"): Locator {
    return this.host.getByText(status, { exact: true });
  }

  /** The row's button and the confirm (`transfer-decision-dialog.tsx`) share the name. */
  async decideTransfer(name: "Approve" | "Reject"): Promise<void> {
    await this.host.getByRole("button", { name, exact: true }).click();
    const dialog = this.alertDialog(name);
    await dialog.getByRole("button", { name, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  get completeTransferTrigger(): Locator {
    return this.host.getByRole("button", { name: "Complete", exact: true });
  }

  /**
   * An inter-campus transfer of an enrolled student opens a dialog with a destination
   * section picker; any other transfer is a plain confirm (`complete-transfer-dialog.tsx`).
   * Omit `sectionName` for the latter.
   */
  async completeTransfer(values: { sectionName?: string | RegExp } = {}): Promise<void> {
    await this.completeTransferTrigger.click();
    if (values.sectionName) {
      const dialog = this.dialog("Complete");
      await this.chooseOption(dialog, "Section", values.sectionName);
      await dialog.getByRole("button", { name: "Complete", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    } else {
      const dialog = this.alertDialog("Complete");
      await dialog.getByRole("button", { name: "Complete", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
  }
}
