import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/{examId}?tab=marks` — an exam's Marks tab: the progress list (one row per subject and
 * section, with "Enter marks for {subject}, {class} – {section}", "Lock {subject} marks for
 * {class}" and "Unlock …"), and, at `?tab=marks&subject=&section=`, that section's grid (per
 * student "Theory marks for {name}", "{name} was absent", "{name} is exempt", "Remarks for
 * {name}"; "Save draft", "Submit", "Back to progress"). See
 * `apps/dashboard/src/features/exams/marks/`.
 */
export class ExamMarksPage extends BasePage {
  readonly path = "/exams";

  /** The Marks tab of the exam with this id. */
  async gotoMarks(examId: string): Promise<void> {
    await this.goto({ path: `/exams/${examId}?tab=marks` });
  }

  /** The progress row of this subject and section (`{class} – {section}`). */
  progressRow(subject: string, section: string): Locator {
    return this.page
      .getByRole("tabpanel")
      .getByRole("row")
      .filter({ hasText: subject })
      .filter({ hasText: section });
  }

  /** Every data row of the progress list. */
  get progressRows(): Locator {
    return this.page
      .getByRole("table", { name: "Marks entry progress by subject and section" })
      .getByRole("row")
      .filter({ has: this.page.getByRole("cell") });
  }

  enterButton(subject: string, section: string): Locator {
    return this.page.getByRole("button", {
      name: `Enter marks for ${subject}, ${section}`,
      exact: true,
    });
  }

  /** A progress row's Lock button. Lock acts on the whole exam-subject, so every section's row
   * carries one with the same name; it is found inside the row. */
  lockButton(subject: string, section: string, className: string): Locator {
    return this.progressRow(subject, section).getByRole("button", {
      name: `Lock ${subject} marks for ${className}`,
      exact: true,
    });
  }

  unlockButton(subject: string, section: string, className: string): Locator {
    return this.progressRow(subject, section).getByRole("button", {
      name: `Unlock ${subject} marks for ${className}`,
      exact: true,
    });
  }

  /** The note shown while the exam takes marks with a subject locked. */
  get unlockHint(): Locator {
    return this.page.getByText(/^Some subjects are locked and take no marks/);
  }

  /** The open grid's region, named by its heading (`{subject} · {class} – {section}`). */
  grid(heading: string): Locator {
    return this.page.getByRole("region", { name: heading, exact: true });
  }

  /** A student's row in the open grid. */
  gridRow(studentName: string): Locator {
    return this.page.getByRole("tabpanel").getByRole("row").filter({ hasText: studentName });
  }

  theoryInput(studentName: string): Locator {
    return this.page.getByRole("textbox", { name: `Theory marks for ${studentName}`, exact: true });
  }

  /** Every theory input of the open grid: none while it is read-only. */
  get theoryInputs(): Locator {
    return this.page.getByRole("textbox", { name: /^Theory marks for / });
  }

  absentCheckbox(studentName: string): Locator {
    return this.page.getByRole("checkbox", { name: `${studentName} was absent`, exact: true });
  }

  get saveDraftButton(): Locator {
    return this.page.getByRole("button", { name: "Save draft", exact: true });
  }

  get submitButton(): Locator {
    return this.page.getByRole("button", { name: "Submit", exact: true });
  }

  get backButton(): Locator {
    return this.page.getByRole("button", { name: "Back to progress", exact: true });
  }

  /** A banner in the tab carrying this text: a refused save's sentence, or why a grid is
   * read-only. Several can show at once, so it is found by its words. */
  notice(text: string): Locator {
    return this.page.getByRole("tabpanel").getByRole("alert").filter({ hasText: text });
  }
}
