import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/{examId}?tab=schedule` — an exam's Schedule tab: its sittings by date, the clash list
 * ("Clashes"), "Add sitting", per-row "Reschedule {subject}, {class} {section}", and "Publish
 * schedule" with its confirm. See `apps/dashboard/src/features/exams/schedule/`.
 */
export class ExamSchedulePage extends BasePage {
  readonly path = "/exams";

  /** The Schedule tab of the exam with this id. */
  async gotoSchedule(examId: string): Promise<void> {
    await this.goto({ path: `/exams/${examId}?tab=schedule` });
  }

  /** The panel's list of findings, each with its message. */
  get conflictList(): Locator {
    return this.page.getByRole("list", { name: "Clashes", exact: true });
  }

  /** "No clashes found." once the schedule is clean. */
  get noConflicts(): Locator {
    return this.page.getByText("No clashes found.", { exact: true });
  }

  /** The count beside Publish schedule while a hard finding stands. */
  get blockedNote(): Locator {
    return this.page.getByText(/blocking (clash|clashes) to resolve first$/);
  }

  /** A sitting's Reschedule button, named after its paper, class and section. */
  rescheduleButton(subject: string, className: string, section: string): Locator {
    return this.page.getByRole("button", {
      name: `Reschedule ${subject}, ${className} ${section}`,
      exact: true,
    });
  }

  get sittingDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Reschedule sitting", exact: true });
  }

  sittingField(label: "Date" | "Starts" | "Ends"): Locator {
    return this.sittingDialog.getByLabel(label, { exact: true });
  }

  get saveSittingButton(): Locator {
    return this.sittingDialog.getByRole("button", { name: "Save", exact: true });
  }

  get publishButton(): Locator {
    return this.page.getByRole("button", { name: "Publish schedule", exact: true });
  }

  get publishDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  get confirmPublish(): Locator {
    return this.publishDialog.getByRole("button", { name: "Publish schedule", exact: true });
  }
}
