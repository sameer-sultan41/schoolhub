import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/{examId}?tab=results` — an exam's Results tab: the lifecycle bar ("Process results",
 * "Processed by {name}", the reason Approve is held, "Send back", "Approve", "Publish results"),
 * their confirm dialogs, and the cursor-paged results (rank, student, section, percentage,
 * grade, GPA, outcome, status) with per-row "Withhold {name}'s result" and its reason dialog.
 * See `apps/dashboard/src/features/exams/results/`.
 */
export class ExamResultsPage extends BasePage {
  readonly path = "/exams";

  /** The Results tab of the exam with this id. */
  async gotoResults(examId: string): Promise<void> {
    await this.goto({ path: `/exams/${examId}?tab=results` });
  }

  /** The exam page's tab of this name. */
  tab(name: "Subjects" | "Results" | "Report cards"): Locator {
    return this.page
      .getByRole("tablist", { name: "Exam sections" })
      .getByRole("tab", { name, exact: true });
  }

  /** Named by its caption (`exams.results.caption`). */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Results for this exam", exact: true });
  }

  /** The result row of the student with this name. */
  row(studentName: string): Locator {
    return this.table.getByRole("row").filter({ hasText: studentName });
  }

  get processButton(): Locator {
    return this.page.getByRole("button", { name: "Process results", exact: true });
  }

  /** "Processed by {name}" beside the approval actions. */
  processedBy(name: string): Locator {
    return this.page.getByText(`Processed by ${name}`, { exact: true });
  }

  /** The note beside a held Approve: the viewer ran the processing. */
  get ownRunNote(): Locator {
    return this.page.getByText("You processed these results, so someone else must approve them.", {
      exact: true,
    });
  }

  get approveButton(): Locator {
    return this.page.getByRole("button", { name: "Approve", exact: true });
  }

  get sendBackButton(): Locator {
    return this.page.getByRole("button", { name: "Send back", exact: true });
  }

  get publishButton(): Locator {
    return this.page
      .getByRole("tabpanel")
      .getByRole("button", { name: "Publish results", exact: true });
  }

  /** The open confirm dialog (approve or publish). Its confirm button repeats the trigger's
   * name, so it is found inside the dialog. */
  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  confirm(label: "Approve results" | "Publish results"): Locator {
    return this.confirmDialog.getByRole("button", { name: label, exact: true });
  }

  withholdButton(studentName: string): Locator {
    return this.page.getByRole("button", {
      name: `Withhold ${studentName}'s result`,
      exact: true,
    });
  }

  get withholdDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^Withhold .+'s result$/ });
  }

  get withholdReason(): Locator {
    return this.withholdDialog.getByLabel("Reason", { exact: true });
  }

  get confirmWithhold(): Locator {
    return this.withholdDialog.getByRole("button", { name: "Withhold result", exact: true });
  }

  /** A refusal under Process results (marks outstanding), found by its words. */
  notice(text: string): Locator {
    return this.page.getByRole("tabpanel").getByRole("alert").filter({ hasText: text });
  }
}
