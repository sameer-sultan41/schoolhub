import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/students/{id}` — see `apps/dashboard/src/features/students/student-detail-sheet.tsx`,
 * `student-guardians-tab.tsx`, `student-emergency-contacts-tab.tsx`,
 * `student-enrollment-tab.tsx` (shipped as the "History" tab — `tabs.history` in the
 * messages catalogue, not a separate "Enrollment" label).
 *
 * Every dialog's trigger button and its in-dialog submit button share the same
 * accessible name (e.g. "Link guardian" labels both the `DialogTrigger` and the
 * `DialogFooter` submit — confirmed in the source, not assumed), so every submit locator
 * below is scoped to `getByRole("dialog")` to avoid a strict-mode violation once the
 * dialog is open.
 */
export class StudentDetailPage extends BasePage {
  readonly path = "";

  override async goto(options: { path?: string } = {}): Promise<void> {
    if (!options.path) throw new Error("StudentDetailPage.goto requires a student id path");
    await this.page.goto(options.path);
  }

  private get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  /**
   * Radix keeps a `Dialog` mounted through its close animation, so a check made right
   * after a submit click can still see the dialog's own button sharing an accessible
   * name with the page-level trigger behind it (e.g. both named "Link guardian") — a
   * strict-mode violation waiting to happen, not just a flaky one. Every mutating method
   * below awaits this before returning, so the caller's next assertion is never racing
   * the animation.
   */
  private async waitForDialogClosed(): Promise<void> {
    await this.dialog.waitFor({ state: "hidden" });
  }

  /** The admission number has no label — it's a plain display string, `{year}-{seq}`. */
  admissionNumber(value: string): Locator {
    return this.page.getByText(value, { exact: true });
  }

  tab(name: "Guardians" | "Emergency contacts" | "Documents" | "History"): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  private get alertDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  // --- Guardians ---

  get linkGuardianTrigger(): Locator {
    return this.page.getByRole("button", { name: "Link guardian", exact: true });
  }

  get createNewGuardianTab(): Locator {
    return this.dialog.getByRole("button", { name: "Create new", exact: true });
  }

  get guardianFirstName(): Locator {
    return this.dialog.getByLabel("First name", { exact: true });
  }

  get guardianLastName(): Locator {
    return this.dialog.getByLabel("Last name", { exact: true });
  }

  get guardianPhone(): Locator {
    return this.dialog.getByLabel("Phone", { exact: true });
  }

  get submitLinkGuardian(): Locator {
    return this.dialog.getByRole("button", { name: "Link guardian", exact: true });
  }

  async createAndLinkGuardian(values: {
    firstName: string;
    lastName: string;
    phone: string;
  }): Promise<void> {
    await this.linkGuardianTrigger.click();
    await this.createNewGuardianTab.click();
    await this.guardianFirstName.fill(values.firstName);
    await this.guardianLastName.fill(values.lastName);
    await this.guardianPhone.fill(values.phone);
    await this.submitLinkGuardian.click();
    await this.waitForDialogClosed();
  }

  // --- Emergency contacts ---

  get addContactTrigger(): Locator {
    return this.page.getByRole("button", { name: "Add contact", exact: true });
  }

  get contactName(): Locator {
    return this.dialog.getByLabel("Name", { exact: true });
  }

  get contactRelationship(): Locator {
    return this.dialog.getByLabel("Relationship", { exact: true });
  }

  get contactPhone(): Locator {
    return this.dialog.getByLabel("Phone", { exact: true });
  }

  get submitAddContact(): Locator {
    return this.dialog.getByRole("button", { name: "Add contact", exact: true });
  }

  async addEmergencyContact(values: {
    name: string;
    relationship: string;
    phone: string;
  }): Promise<void> {
    await this.addContactTrigger.click();
    await this.contactName.fill(values.name);
    await this.contactRelationship.fill(values.relationship);
    await this.contactPhone.fill(values.phone);
    await this.submitAddContact.click();
    await this.waitForDialogClosed();
  }

  // --- Enrollment ---

  get enrollTrigger(): Locator {
    return this.page.getByRole("button", { name: "Enroll", exact: true });
  }

  get enrollDate(): Locator {
    return this.dialog.getByLabel("Enrollment date", { exact: true });
  }

  get submitEnroll(): Locator {
    return this.dialog.getByRole("button", { name: "Enroll", exact: true });
  }

  /** Same pattern as `StaffPage.chooseOption` — scoped to the open dialog here since
   * every field label on this detail page is reused across more than one dialog. */
  async chooseOption(fieldLabel: string, optionName: string | RegExp): Promise<void> {
    await this.dialog.getByLabel(fieldLabel, { exact: true }).click();
    await this.page.getByRole("option", { name: optionName }).click();
  }

  async enroll(values: {
    sessionName: string;
    className: string;
    sectionName: string;
    enrollmentDate: string;
  }): Promise<void> {
    await this.enrollTrigger.click();
    await this.chooseOption("Academic session", values.sessionName);
    await this.chooseOption("Class", values.className);
    await this.chooseOption("Section", values.sectionName);
    await this.enrollDate.fill(values.enrollmentDate);
    await this.submitEnroll.click();
    await this.waitForDialogClosed();
  }

  /**
   * Proof of an active enrollment, not text-matched: both the student's own status badge
   * and the enrollment's status badge render the literal word "Active"
   * (`t("status.active")` / `t("enrollment.status.active")`), so asserting on that text
   * would be ambiguous. `EnrollmentPanel`'s "Change section"/"Withdraw" actions are each
   * gated by their own permission (`students.enrollment.update` /
   * `students.student.withdraw`) that `school_admin`'s seeded permission set
   * deliberately does not hold (only `students.enrollment.enroll` — confirmed against
   * the real app: those buttons never render for this identity), so they aren't a usable
   * signal either. The one thing that's true only once an enrollment exists, regardless
   * of which action buttons a role can see, is that `enrollment.notEnrolled`'s copy is
   * gone.
   */
  get notEnrolledMessage(): Locator {
    return this.page.getByText("Not enrolled in an active session.", { exact: true });
  }

  // --- Change section ---

  get changeSectionTrigger(): Locator {
    return this.page.getByRole("button", { name: "Change section", exact: true });
  }

  get submitChangeSection(): Locator {
    return this.dialog.getByRole("button", { name: "Change section", exact: true });
  }

  async changeSection(values: { sectionName: string | RegExp }): Promise<void> {
    await this.changeSectionTrigger.click();
    await this.chooseOption("Section", values.sectionName);
    await this.submitChangeSection.click();
    await this.waitForDialogClosed();
  }

  // --- Transfers ---

  get requestTransferTrigger(): Locator {
    return this.page.getByRole("button", { name: "Request transfer", exact: true });
  }

  get submitRequestTransfer(): Locator {
    return this.dialog.getByRole("button", { name: "Request transfer", exact: true });
  }

  async requestInterCampusTransfer(values: {
    toCampusName: string | RegExp;
    reason: string;
    effectiveDate: string;
  }): Promise<void> {
    await this.requestTransferTrigger.click();
    // "Inter-campus" is this dialog's default transfer type — no radio click needed
    // unless a future caller wants the "outgoing" branch instead.
    await this.chooseOption("To campus", values.toCampusName);
    await this.dialog.getByLabel("Reason", { exact: true }).fill(values.reason);
    await this.dialog.getByLabel("Effective date", { exact: true }).fill(values.effectiveDate);
    await this.submitRequestTransfer.click();
    await this.waitForDialogClosed();
  }

  /** `name` is "Approve"/"Reject" — both buttons carry this exact accessible name,
   * confirmed in `student-enrollment-tab.tsx`. */
  async decideTransfer(name: "Approve" | "Reject"): Promise<void> {
    await this.page.getByRole("button", { name, exact: true }).click();
    await this.alertDialog.getByRole("button", { name, exact: true }).click();
    await this.alertDialog.waitFor({ state: "hidden" });
  }

  get completeTransferTrigger(): Locator {
    return this.page.getByRole("button", { name: "Complete", exact: true });
  }

  get submitCompleteTransfer(): Locator {
    return this.dialog.getByRole("button", { name: "Complete", exact: true });
  }

  /** The destination-section picker only renders when the student has an active
   * enrollment to reallocate (`complete-transfer-dialog.tsx`'s own branch) — a caller
   * completing a transfer for a student with none omits `sectionName`, and this clicks
   * the alert-dialog's plain confirm instead. */
  async completeTransfer(values: { sectionName?: string | RegExp } = {}): Promise<void> {
    await this.completeTransferTrigger.click();
    if (values.sectionName) {
      await this.chooseOption("Section", values.sectionName);
      await this.submitCompleteTransfer.click();
      await this.waitForDialogClosed();
    } else {
      await this.alertDialog.getByRole("button", { name: "Complete", exact: true }).click();
      await this.alertDialog.waitFor({ state: "hidden" });
    }
  }
}
