import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/students/{id}` — see `apps/dashboard/src/features/students/student-detail.tsx`,
 * `guardians-panel.tsx`, `emergency-contacts-panel.tsx`, `enrollment-panel.tsx`.
 *
 * Every dialog's trigger button and its in-dialog submit button share the same
 * accessible name (e.g. "Link guardian" labels both the `DialogTrigger` and the
 * `DialogFooter` submit — confirmed in the source, not assumed), so every submit locator
 * below is scoped to `getByRole("dialog")` to avoid a strict-mode violation once the
 * dialog is open.
 */
export class StudentDetailPage extends BasePage {
  readonly path = "";

  async goto(options: { path?: string } = {}): Promise<void> {
    if (!options.path) throw new Error("StudentDetailPage.goto requires a student id path");
    await this.page.goto(options.path);
  }

  private get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  /** The admission number has no label — it's a plain display string, `{year}-{seq}`. */
  admissionNumber(value: string): Locator {
    return this.page.getByText(value, { exact: true });
  }

  tab(name: "Guardians" | "Emergency contacts"): Locator {
    return this.page.getByRole("tab", { name, exact: true });
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
  }

  // --- Enrollment ---

  get enrollTrigger(): Locator {
    return this.page.getByRole("button", { name: "Enroll", exact: true });
  }

  get enrollSession(): Locator {
    return this.dialog.getByLabel("Academic session", { exact: true });
  }

  get enrollClass(): Locator {
    return this.dialog.getByLabel("Class", { exact: true });
  }

  get enrollSection(): Locator {
    return this.dialog.getByLabel("Section", { exact: true });
  }

  get enrollDate(): Locator {
    return this.dialog.getByLabel("Enrollment date", { exact: true });
  }

  get submitEnroll(): Locator {
    return this.dialog.getByRole("button", { name: "Enroll", exact: true });
  }

  async enroll(values: {
    sessionName: string;
    className: string;
    sectionName: string;
    enrollmentDate: string;
  }): Promise<void> {
    await this.enrollTrigger.click();
    await this.enrollSession.click();
    await this.page.getByRole("option", { name: values.sessionName }).click();
    await this.enrollClass.click();
    await this.page.getByRole("option", { name: values.className }).click();
    await this.enrollSection.click();
    await this.page.getByRole("option", { name: values.sectionName }).click();
    await this.enrollDate.fill(values.enrollmentDate);
    await this.submitEnroll.click();
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
}
