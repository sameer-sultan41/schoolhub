import type { Locator } from "@playwright/test";
import { AcademicsPage } from "./academics-base.page";

/** The names a transition's trigger and its confirm button share. */
export type PromotionActionName =
  "Submit for approval" | "Approve" | "Reject" | "Execute" | "Revert";

/**
 * `/academics/promotions/{batchId}` — the §7.2 promotion batch review screen: the header with
 * the batch's status, the buttons its status and the viewer's keys offer (each behind a confirm
 * dialog), the execution report, and the per-student decision table with its edit dialog
 * (`PromotionDecisionDialog`). See `apps/dashboard/src/features/academics/promotions/`.
 *
 * The live journey (`tests/live/academics-promotion-journey.spec.ts`) and the mocked spec share
 * this page object, so the PR gate exercises the confirm flow the nightly lane depends on.
 *
 * Every transition opens an `alertdialog` whose confirm button has the same name as the button
 * that opened it. The page-level triggers (`submitForApproval`, `approve`, ...) are what a
 * permission check counts; a click on one goes through `confirm`, which is scoped to the dialog,
 * or an `...AndConfirm` method.
 *
 * Locators and navigation only — no assertions (see `base.page.ts`).
 */
export class PromotionBatchPage extends AcademicsPage {
  readonly path = "/academics/promotions";

  /**
   * A batch is addressed by its own id — `batch_id` is a logical grouping with no table of its
   * own (`StudentPromotion`'s docstring), so the screen is "the rows sharing this batch id".
   *
   * A full page load, not a client-side click: a caller has no guarantee of where it is. Each
   * call costs a real `/auth/refresh` in the live lane (the access token is memory-only), which
   * is why the journey spec counts them — see its header.
   */
  async gotoBatch(batchId: string): Promise<void> {
    await this.page.goto(`${this.path}/${batchId}`);
  }

  /**
   * The batch's current status, as the header badge writes it — "Draft", "Pending approval",
   * "Approved", "Executed", "Reverted". Matched on exact text: the badge is the only place the
   * page says the status (every decision row shares it, so the table has no status column), so
   * this finds exactly one element.
   */
  statusBadge(label: string): Locator {
    return this.page.getByText(label, { exact: true });
  }

  // ---- The batch's actions ----

  get submitForApproval(): Locator {
    return this.page.getByRole("button", { name: "Submit for approval", exact: true });
  }

  get approve(): Locator {
    return this.page.getByRole("button", { name: "Approve", exact: true });
  }

  get reject(): Locator {
    return this.page.getByRole("button", { name: "Reject", exact: true });
  }

  get execute(): Locator {
    return this.page.getByRole("button", { name: "Execute", exact: true });
  }

  get revert(): Locator {
    return this.page.getByRole("button", { name: "Revert", exact: true });
  }

  /**
   * The Execute button while a run is in progress. It is loading then, so its accessible name
   * gains the loading label ("Loading Execute") and `execute` finds nothing; it is also
   * disabled.
   */
  get executeInProgress(): Locator {
    return this.page.getByRole("button", { name: /^Loading\s*Execute$/ });
  }

  // ---- Confirm dialog ----

  get confirmDialog(): Locator {
    return this.page.getByRole("alertdialog");
  }

  /** The dialog's confirm button, named like the trigger that opened it. Scoped to the dialog:
   * the trigger carries the same name. */
  confirm(name: PromotionActionName): Locator {
    return this.confirmDialog.getByRole("button", { name, exact: true });
  }

  get cancelConfirm(): Locator {
    return this.confirmDialog.getByRole("button", { name: "Cancel", exact: true });
  }

  async submitForApprovalAndConfirm(): Promise<void> {
    await this.submitForApproval.click();
    await this.confirm("Submit for approval").click();
  }

  async approveAndConfirm(): Promise<void> {
    await this.approve.click();
    await this.confirm("Approve").click();
  }

  async executeAndConfirm(): Promise<void> {
    await this.execute.click();
    await this.confirm("Execute").click();
  }

  // ---- Notices and the execution report ----

  /** The batch's from and to sessions, as the header writes them ("2026-27 → 2027-28"). */
  sessionPair(from: string, to: string): Locator {
    return this.page.getByText(`${from} → ${to}`, { exact: true });
  }

  /** The advisory over the table: students with no target section, who fail on execute. */
  get missingSectionsNotice(): Locator {
    return this.page.getByText(/no target section and will fail on execute/);
  }

  /** The running job's progress line, e.g. "Executing — 40%". */
  executionProgress(percent: number): Locator {
    return this.page.getByText(`Executing — ${percent}%`, { exact: true });
  }

  get reportTitle(): Locator {
    return this.page.getByText("Execution report", { exact: true });
  }

  /** A count line of the report, by its whole text ("Enrolled in the next session: 2",
   * "Failed: 1"). */
  reportOutcome(label: string): Locator {
    return this.page.getByText(label, { exact: true });
  }

  /** A student's line in the report's skipped or failed list ("{name} ({number}): {reason}"). */
  reportEntry(text: string): Locator {
    return this.page.getByText(text);
  }

  /** The screen's empty state for a batch the API cannot find (or another school owns). */
  get notFoundTitle(): Locator {
    return this.page.getByText("Promotion batch not found", { exact: true });
  }

  /** The way back to the list: in the header, and in the not-found state. */
  get backToList(): Locator {
    return this.page.getByRole("link", { name: "All batches", exact: true });
  }

  // ---- Decisions ----

  /** One student's decision row, found by the student's visible name. */
  decisionRow(studentName: string): Locator {
    return this.page.getByRole("row").filter({ hasText: studentName });
  }

  /** A row's Edit button, offered only on a draft batch to a viewer who may update it. Its
   * accessible name carries the student's, so each row's is its own. */
  editDecision(studentName: string): Locator {
    return this.page.getByRole("button", {
      name: `Edit decision for ${studentName}`,
      exact: true,
    });
  }

  /** Every Edit button, whichever row: for "there are none". */
  get editDecisionButtons(): Locator {
    return this.page.getByRole("button", { name: /^Edit decision for / });
  }

  // ---- Edit decision dialog ----

  get decisionDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Edit decision", exact: true });
  }

  /** Radix Select triggers render as `combobox`, named by their field label. */
  decisionSelect(label: "Decision" | "Target class" | "Target section"): Locator {
    return this.decisionDialog.getByRole("combobox", { name: label, exact: true });
  }

  /** By a prefix match: the label gains a required marker where the decision differs from the
   * proposal. */
  get overrideReasonInput(): Locator {
    return this.decisionDialog.getByLabel(/^Override reason/);
  }

  get saveDecision(): Locator {
    return this.decisionDialog.getByRole("button", { name: "Save", exact: true });
  }
}
