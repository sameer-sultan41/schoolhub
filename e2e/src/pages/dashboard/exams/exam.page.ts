import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/{examId}` — one exam: its header (name, session and term, scale, status, "Back to
 * exams", "Edit exam", "Delete exam"), the status stepper, and its tabs, of which PR A draws
 * Subjects (`ExamSubjectsTable`: one card per class, "Add subject", per-row "Edit {subject} in
 * {class}" / "Remove {subject} from {class}"). See `apps/dashboard/src/features/exams/detail/` and
 * `.../subjects/`.
 */
export class ExamPage extends BasePage {
  readonly path = "/exams";

  /** The page of the exam with this id. */
  async gotoExam(examId: string): Promise<void> {
    await this.goto({ path: `/exams/${examId}` });
  }

  get backToList(): Locator {
    return this.page.getByRole("link", { name: "Back to exams", exact: true });
  }

  get editButton(): Locator {
    return this.page.getByRole("button", { name: "Edit exam", exact: true });
  }

  get deleteButton(): Locator {
    return this.page.getByRole("button", { name: "Delete exam", exact: true });
  }

  /** The status stepper (`exam-status-stepper.tsx`, an `<ol>`). */
  get progress(): Locator {
    return this.page.getByRole("list", { name: "Exam progress" });
  }

  tab(name: "Subjects"): Locator {
    return this.page
      .getByRole("tablist", { name: "Exam sections" })
      .getByRole("tab", { name, exact: true });
  }

  /** A class's card on the Subjects tab, by its title. */
  classHeading(className: string): Locator {
    return this.page
      .getByRole("tabpanel")
      .getByRole("heading", { level: 3, name: className, exact: true });
  }

  subjectRow(subjectName: string): Locator {
    return this.page.getByRole("tabpanel").getByRole("row").filter({ hasText: subjectName });
  }

  get addSubjectButton(): Locator {
    return this.page.getByRole("button", { name: "Add subject", exact: true });
  }

  /** A subject row's Edit or Remove button, named after its subject and class. */
  subjectAction(subject: string, className: string, action: "Edit" | "Remove"): Locator {
    const name =
      action === "Edit" ? `Edit ${subject} in ${className}` : `Remove ${subject} from ${className}`;
    return this.page.getByRole("button", { name, exact: true });
  }

  get subjectDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^(Add subject|Edit subject)$/ });
  }

  subjectField(label: "Maximum marks" | "Pass marks" | "Weightage (%)"): Locator {
    return this.subjectDialog.getByLabel(label, { exact: true });
  }

  subjectSelect(label: "Class" | "Subject"): Locator {
    return this.subjectDialog.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  get saveSubjectButton(): Locator {
    return this.subjectDialog.getByRole("button", { name: "Save", exact: true });
  }

  get deleteDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  get confirmDelete(): Locator {
    return this.deleteDialog.getByRole("button", { name: "Delete exam", exact: true });
  }
}
