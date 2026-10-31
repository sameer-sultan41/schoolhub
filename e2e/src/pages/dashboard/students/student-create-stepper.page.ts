import type { Locator, Page } from "@playwright/test";
import { BasePage } from "../../base.page";
import { StudentRelationsPanel } from "./student-relations.panel";

/**
 * The student creation wizard —
 * `apps/dashboard/src/features/students/student-create-stepper.tsx`, opened by the
 * directory toolbar's "New student" button (`StudentsPage.addStudentButton`) on
 * `/students`. It has no route of its own.
 *
 * Profile → Guardians → Emergency contacts → Documents → History, each step past
 * Profile shown only to a viewer holding its key. Profile creates the real student the
 * moment it is submitted; every later step works on that record and renders the same
 * relation panels the detail sheet does, so `relations` is the same page object the
 * sheet uses, scoped to this dialog.
 *
 * The dialog is titled "New student", the same name as the button that opens it, so it
 * is found by role and name and every control below is scoped through it.
 */
export class StudentCreateStepperPage extends BasePage {
  readonly path = "/students";
  /** The Guardians, Emergency contacts and History steps' actions. */
  readonly relations: StudentRelationsPanel;

  constructor(page: Page) {
    super(page);
    this.relations = new StudentRelationsPanel(page, this.dialog);
  }

  get dialog(): Locator {
    return this.page.getByRole("dialog", { name: "New student", exact: true });
  }

  field(label: "First name" | "Last name" | "Date of birth" | "Admission date"): Locator {
    return this.dialog.getByLabel(label, { exact: true });
  }

  get campus(): Locator {
    return this.dialog.getByRole("combobox", { name: "Campus", exact: true });
  }

  /** On Profile this submits it; on a later step it moves on. The last step has none. */
  get next(): Locator {
    return this.dialog.getByRole("button", { name: "Next", exact: true });
  }

  /** On Profile this submits it and closes; on a later step it just closes. One per step. */
  get finish(): Locator {
    return this.dialog.getByRole("button", { name: "Finish", exact: true });
  }

  /** `stepper.studentCreated`, shown on every step after Profile has created the student. */
  createdBanner(studentName: string): Locator {
    return this.dialog.getByText(`${studentName} has been created.`);
  }

  /** Profile's own `Alert`, where a server error with no field (e.g. a duplicate) lands. */
  get formError(): Locator {
    return this.dialog.getByRole("alert");
  }

  /** Gender keeps its "Unspecified" default; everything else Profile needs is filled. */
  async fillProfile(values: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    admissionDate: string;
    campusName: string;
  }): Promise<void> {
    await this.field("First name").fill(values.firstName);
    await this.field("Last name").fill(values.lastName);
    await this.field("Date of birth").fill(values.dateOfBirth);
    await this.field("Admission date").fill(values.admissionDate);
    // The campus list loads after first paint; the option click waits for it either way.
    await this.campus.click();
    await this.page.getByRole("option", { name: values.campusName, exact: true }).click();
  }
}
