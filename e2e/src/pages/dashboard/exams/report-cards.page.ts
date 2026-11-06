import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/{examId}?tab=report-cards` — an exam's Report cards tab: "Generate report cards" and
 * "Publish report cards" above the cursor-paged cards (student, section, result, version,
 * status), with per-row "Download {name}'s report card" and "Edit remarks on {name}'s report
 * card". See `apps/dashboard/src/features/exams/report-cards/`.
 */
export class ExamReportCardsPage extends BasePage {
  readonly path = "/exams";

  /** The Report cards tab of the exam with this id. */
  async gotoReportCards(examId: string): Promise<void> {
    await this.goto({ path: `/exams/${examId}?tab=report-cards` });
  }

  /** Named by its caption (`exams.reportCards.caption`). */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Report cards for this exam", exact: true });
  }

  /** The card row of the student with this name. */
  row(studentName: string): Locator {
    return this.table.getByRole("row").filter({ hasText: studentName });
  }

  get generateButton(): Locator {
    return this.page.getByRole("button", { name: "Generate report cards", exact: true });
  }

  downloadButton(studentName: string): Locator {
    return this.page.getByRole("button", {
      name: `Download ${studentName}'s report card`,
      exact: true,
    });
  }
}
