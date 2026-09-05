import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/timetable` — the week grid (`apps/dashboard/src/features/timetable/week-grid-screen.tsx`
 * and `slot-form.tsx`).
 *
 * Accessible names come from `apps/dashboard/messages/en.json`'s `timetable.*` and
 * `common.*` namespaces, never from CSS or a `data-testid` (e2e/README.md's "Selectors").
 *
 * The cell locators are the load-bearing ones. A cell is a `<button>` whose accessible
 * name the screen composes from the weekday and the period's own name —
 * `t("grid.fillCell", { cell })` where `cell` is `"Monday · Period 1"` — and it changes
 * to "Edit …" the moment the cell holds a slot. That flip is *itself* a signal worth
 * asserting, so the two are separate locators rather than one regex over both: a spec
 * that just saved a cell wants "Edit" to become true, not "either name matched".
 *
 * The separator is U+00B7 (a middle dot) with a space either side, exactly as the
 * message catalogue writes it — a plain hyphen matches nothing.
 *
 * Locators and navigation only — no assertions (see `base.page.ts`).
 */
export class WeekGridPage extends BasePage {
  readonly path = "/timetable";

  // --- The section picker and the two section-level actions ---

  get academicSession(): Locator {
    return this.page.getByRole("combobox", { name: "Academic session", exact: true });
  }

  get section(): Locator {
    return this.page.getByRole("combobox", { name: "Section", exact: true });
  }

  /** `POST /timetables/{section_id}:validate`. Named for what it does, not the verb. */
  get validate(): Locator {
    return this.page.getByRole("button", { name: "Check for conflicts", exact: true });
  }

  get publish(): Locator {
    return this.page.getByRole("button", { name: "Publish", exact: true });
  }

  // --- Findings ---

  /**
   * The conflict panel, scoped by its own label.
   *
   * Necessary rather than tidy: `CellConflicts` renders the same message a second time
   * inside every cell the finding names, so an unscoped `getByText` on a conflict
   * message is a strict-mode violation as soon as one is reported.
   */
  get conflictPanel(): Locator {
    return this.page.getByRole("list", { name: "Conflicts" });
  }

  /** Rendered only after a *successful* `:validate` run with nothing to report. */
  get noConflicts(): Locator {
    return this.page.getByText("No conflicts found.", { exact: true });
  }

  publishedSummary(count: number): Locator {
    return this.page.getByText(`Published ${count} periods.`, { exact: true });
  }

  // --- Cells ---

  emptyCell(weekday: string, periodName: string): Locator {
    return this.page.getByRole("button", { name: `Fill ${weekday} · ${periodName}`, exact: true });
  }

  filledCell(weekday: string, periodName: string): Locator {
    return this.page.getByRole("button", { name: `Edit ${weekday} · ${periodName}`, exact: true });
  }

  // --- The cell editor dialog ---

  private get dialog(): Locator {
    return this.page.getByRole("dialog");
  }

  get save(): Locator {
    return this.dialog.getByRole("button", { name: "Save", exact: true });
  }

  /**
   * A Radix `Select` inside the dialog. Its listbox renders through a portal at the end
   * of the document body rather than inside the dialog, so the trigger is scoped to the
   * dialog and the option is not — the same split `student-detail.page.ts` documents.
   */
  private async chooseOption(fieldLabel: string, optionName: string): Promise<void> {
    await this.dialog.getByRole("combobox", { name: fieldLabel, exact: true }).click();
    await this.page.getByRole("option", { name: optionName }).click();
  }

  /**
   * Radix keeps a dialog mounted through its close animation, so a locator resolved
   * immediately after a submit can still see it. Every method below awaits this before
   * returning, so a caller's next assertion never races the animation.
   */
  private async waitForDialogClosed(): Promise<void> {
    await this.dialog.waitFor({ state: "hidden" });
  }

  async selectSession(name: string): Promise<void> {
    await this.academicSession.click();
    await this.page.getByRole("option", { name }).click();
  }

  /**
   * `sectionLabel` is matched as a substring: the option renders as
   * `"{class name} {section name}"`, and the class half comes from a *separate* query
   * (`useClasses`) that may not have resolved yet — passing the run-unique section name
   * alone identifies the row either way.
   */
  async selectSection(sectionLabel: string): Promise<void> {
    await this.section.click();
    await this.page.getByRole("option", { name: sectionLabel }).click();
  }

  /** Fills an empty cell: subject, teacher, save. */
  async fillCellWith(values: {
    weekday: string;
    periodName: string;
    subjectName: string;
    teacherName: string;
  }): Promise<void> {
    await this.emptyCell(values.weekday, values.periodName).click();
    await this.chooseOption("Subject", values.subjectName);
    await this.chooseOption("Teacher", values.teacherName);
    await this.save.click();
    await this.waitForDialogClosed();
  }

  /** Re-opens a filled cell and moves it onto a different subject. */
  async changeCellSubject(values: {
    weekday: string;
    periodName: string;
    subjectName: string;
  }): Promise<void> {
    await this.filledCell(values.weekday, values.periodName).click();
    await this.chooseOption("Subject", values.subjectName);
    await this.save.click();
    await this.waitForDialogClosed();
  }
}
