import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/timetable/grid` — the week grid (`apps/dashboard/src/features/timetable/grid/`:
 * `timetable-grid-screen.tsx`, `week-grid.tsx`, `slot-cell.tsx`, `slot-form-dialog.tsx`).
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
  readonly path = "/timetable/grid";

  // --- The section picker and the two section-level actions ---

  get academicSession(): Locator {
    return this.page.getByRole("combobox", { name: "Academic session", exact: true });
  }

  get schoolClass(): Locator {
    return this.page.getByRole("combobox", { name: "Class", exact: true });
  }

  get section(): Locator {
    return this.page.getByRole("combobox", { name: "Section", exact: true });
  }

  /** `POST /timetables/{section_id}:validate`. Named for what it does, not the verb. */
  get validate(): Locator {
    return this.page.getByRole("button", { name: "Check for conflicts", exact: true });
  }

  /** The toolbar's Publish, which opens a confirm; `confirmPublish` presses the dialog's. */
  get publish(): Locator {
    return this.page.getByRole("button", { name: "Publish", exact: true }).first();
  }

  /** The publish confirm. Its button repeats the trigger's name, so it is scoped here. */
  get publishDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  async publishAndConfirm(): Promise<void> {
    await this.publish.click();
    await this.publishDialog.getByRole("button", { name: "Publish", exact: true }).click();
    await this.publishDialog.waitFor({ state: "hidden" });
  }

  // --- Findings ---

  /**
   * The conflict panel, scoped by its own label.
   *
   * Necessary rather than tidy: every cell a finding names repeats its message, so an unscoped `getByText` on a conflict
   * message is a strict-mode violation as soon as one is reported.
   */
  get conflictPanel(): Locator {
    return this.page.getByRole("list", { name: "Conflicts" });
  }

  /** Rendered, outside the list, only after a check that found nothing. */
  get noConflicts(): Locator {
    return this.page.getByText("No conflicts found.", { exact: true });
  }

  /** The publish toast, in `grid.published`'s singular or plural. */
  publishedSummary(count: number): Locator {
    const periods = count === 1 ? "period" : "periods";
    return this.page.getByText(`Published ${count} ${periods}.`, { exact: true });
  }

  // --- Cells ---

  /** A pure draft's drag handle; a published cell, or a draft over one, has none. */
  moveHandle(weekday: string, periodName: string): Locator {
    return this.page.getByRole("button", { name: `Move ${weekday} · ${periodName}`, exact: true });
  }

  emptyCell(weekday: string, periodName: string): Locator {
    return this.page.getByRole("button", { name: `Fill ${weekday} · ${periodName}`, exact: true });
  }

  filledCell(weekday: string, periodName: string): Locator {
    return this.page.getByRole("button", { name: `Edit ${weekday} · ${periodName}`, exact: true });
  }

  // --- The cell editor dialog ---

  /**
   * Moves a draft by keyboard: Space on its handle, one arrow key per step, Space to drop.
   * `overCells` names the cell each step lands on ("Tuesday · Period 1").
   *
   * Waits between keys rather than pressing them back to back. dnd-kit's keyboard sensor
   * starts listening for arrow keys a tick *after* Space starts the drag, and starting it
   * re-measures every cell; a browser runs queued key presses before that timer, so a key
   * sent in the same breath is silently lost. The drag is live once the handle is
   * `aria-pressed`, and each step has landed once dnd-kit's live region announces it.
   */
  async keyboardMove(
    weekday: string,
    periodName: string,
    steps: readonly { key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"; over: string }[],
  ): Promise<void> {
    const handle = this.moveHandle(weekday, periodName);
    await handle.focus();
    await this.page.keyboard.press("Space");
    await this.page.locator('[aria-roledescription="draggable"][aria-pressed="true"]').waitFor();
    for (const step of steps) {
      await this.page.keyboard.press(step.key);
      await this.page
        .getByText(`Over ${step.over}.`, { exact: true })
        .waitFor({ state: "attached" });
    }
    await this.page.keyboard.press("Space");
  }

  get dialog(): Locator {
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

  async selectClass(name: string): Promise<void> {
    await this.schoolClass.click();
    await this.page.getByRole("option", { name, exact: true }).click();
  }

  /** The section picker lists the picked class's sections, by section name. */
  async selectSection(sectionLabel: string): Promise<void> {
    await this.section.click();
    await this.page.getByRole("option", { name: sectionLabel }).click();
  }

  /** Fills an empty cell: subject, teacher, save. A teacher allocated to the subject is
   * listed as "{name} · allocated", so the name is matched as a substring. */
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
