import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/exams/question-banks` and a bank's own page (`/exams/question-banks/{id}`): the banks table
 * (each name a link to its bank), the toolbar's "New question bank", a bank's questions table with
 * each row's "Approve the question {text}", and the Assemble paper dialog with its numbered
 * sections. See `apps/dashboard/src/features/exams/question-banks/`.
 */
export class QuestionBanksPage extends BasePage {
  readonly path = "/exams/question-banks";

  async gotoBank(bankId: string): Promise<void> {
    await this.goto({ path: `${this.path}/${bankId}` });
  }

  /** Named by its caption (`questionBanks.list.caption`). */
  get table(): Locator {
    return this.page.getByRole("table", { name: "Question banks", exact: true });
  }

  row(name: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: name });
  }

  bankLink(name: string): Locator {
    return this.table.getByRole("link", { name, exact: true });
  }

  get createButton(): Locator {
    return this.page.getByRole("button", { name: "New question bank", exact: true });
  }

  /** A bank's questions, named by their caption (`questionBanks.questions.caption`). */
  get questionsTable(): Locator {
    return this.page.getByRole("table", { name: "Questions in this bank", exact: true });
  }

  questionRow(text: string): Locator {
    return this.questionsTable.getByRole("row").filter({ hasText: text });
  }

  approveButton(text: string): Locator {
    return this.page.getByRole("button", { name: `Approve the question ${text}`, exact: true });
  }

  /** The approval confirm; its Approve repeats the row's, so it is reached through this. */
  get approveDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  /** Any row's Approve, for asserting none is offered. */
  get anyApproveButton(): Locator {
    return this.questionsTable.getByRole("button", { name: /^Approve the question / });
  }

  get assembleButton(): Locator {
    return this.page.getByRole("button", { name: "Assemble paper", exact: true });
  }

  get paperDialog(): Locator {
    return this.page.getByRole("dialog", { name: /^Assemble a paper from / });
  }

  get paperTitle(): Locator {
    return this.paperDialog.getByLabel("Paper title", { exact: true });
  }

  /** Section `number` of the blueprint (from 1), a group named "Section {number}". */
  section(number: number): Locator {
    return this.paperDialog.getByRole("group", { name: `Section ${number}`, exact: true });
  }

  sectionField(
    number: number,
    label: "Section heading" | "Topic" | "Questions" | "Marks each",
  ): Locator {
    return this.section(number).getByLabel(label, { exact: true });
  }

  sectionDifficulty(number: number): Locator {
    return this.section(number).getByRole("combobox", { name: "Difficulty", exact: true });
  }

  get addSectionButton(): Locator {
    return this.paperDialog.getByRole("button", { name: "Add section", exact: true });
  }

  /** The dialog's own submit, which repeats the header's "Assemble paper". */
  get submitPaperButton(): Locator {
    return this.paperDialog.getByRole("button", { name: "Assemble paper", exact: true });
  }

  /** A select's option; options render in a portal, outside the dialog. */
  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }
}
