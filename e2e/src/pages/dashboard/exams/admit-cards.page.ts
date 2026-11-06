import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/{examId}?tab=admit-cards` — an exam's Admit cards tab: the cursor-paged cards
 * (number, student, admission number, section, status), the Section and Status filters, "Issue
 * admit cards" with the server's counts beside it, per-row "Download {name}'s admit card" and
 * "Revoke {name}'s admit card", and the revoke dialog. See
 * `apps/dashboard/src/features/exams/admit-cards/`.
 */
export class ExamAdmitCardsPage extends BasePage {
  readonly path = "/exams";

  /** The Admit cards tab of the exam with this id. */
  async gotoAdmitCards(examId: string): Promise<void> {
    await this.goto({ path: `/exams/${examId}?tab=admit-cards` });
  }

  /** The exam page's tab of this name. */
  tab(name: "Schedule" | "Admit cards"): Locator {
    return this.page
      .getByRole("tablist", { name: "Exam sections" })
      .getByRole("tab", { name, exact: true });
  }

  /** The card row of the student with this name. */
  row(studentName: string): Locator {
    return this.page.getByRole("tabpanel").getByRole("row").filter({ hasText: studentName });
  }

  /** The empty state of a draft exam's tab: no cards before the schedule is published. */
  get draftNotice(): Locator {
    return this.page.getByText("Admit cards are issued once the schedule is published.", {
      exact: true,
    });
  }

  get issueButton(): Locator {
    return this.page.getByRole("button", { name: "Issue admit cards", exact: true });
  }

  /** The line beside Issue admit cards: the server's own counts for the last run. */
  get issueStatus(): Locator {
    return this.page.getByRole("tabpanel").getByRole("status").filter({ hasText: "admit card" });
  }

  downloadButton(studentName: string): Locator {
    return this.page.getByRole("button", {
      name: `Download ${studentName}'s admit card`,
      exact: true,
    });
  }

  revokeButton(studentName: string): Locator {
    return this.page.getByRole("button", {
      name: `Revoke ${studentName}'s admit card`,
      exact: true,
    });
  }

  get revokeDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^Revoke .+'s admit card$/ });
  }

  get revokeReason(): Locator {
    return this.revokeDialog.getByLabel("Reason", { exact: true });
  }

  get confirmRevoke(): Locator {
    return this.revokeDialog.getByRole("button", { name: "Revoke card", exact: true });
  }

  filter(label: "Section" | "Status"): Locator {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }
}
