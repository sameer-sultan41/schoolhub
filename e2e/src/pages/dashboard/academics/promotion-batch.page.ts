import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/academics/promotions/{batchId}` — the §7.2 promotion batch review screen.
 *
 * **Provisional: this screen does not exist yet.** The academics dashboard is being
 * built in parallel with this suite, so every locator below is an accessible *name*
 * implied by the module doc rather than one read off a component:
 *
 * - the route mirrors the API resource (`/student-promotions/{batch}`), the way
 *   `/students/{id}` mirrors `/students/{id}`;
 * - the action buttons are named for the colon-actions they call — `:submit`,
 *   `:approve`, `:reject`, `:execute` (academics.md §16) — which is also how §8's
 *   journeys describe them ("approves", "executes the batch");
 * - the status text is the `PromotionStatus` label set (`draft`, `pending_approval`,
 *   `approved`, `executed`), which is what a badge on this screen has to render.
 *
 * When the real screen lands, reconcile these names with it — and if a control turns out
 * to have no accessible name, that is an accessibility bug in the component, not a reason
 * to reach for a CSS selector or a `data-testid` (e2e/README.md's "Selectors").
 *
 * Locators and navigation only — no assertions (see `base.page.ts`).
 */
export class PromotionBatchPage extends BasePage {
  readonly path = "/academics/promotions";

  /**
   * A batch is addressed by its own id — `batch_id` is a logical grouping with no table
   * of its own (`StudentPromotion`'s docstring), so the screen is "the rows sharing this
   * batch id", not a row detail page.
   *
   * A full page load, not a client-side click: this suite has no guarantee about where
   * the caller is, and the nav's academics entry is itself unbuilt. Each call costs a
   * real `/auth/refresh` (the access token is memory-only), which is why the journey
   * spec counts them — see its header.
   */
  async gotoBatch(batchId: string): Promise<void> {
    await this.page.goto(`${this.path}/${batchId}`);
  }

  /**
   * The batch's current state, as rendered — "Draft", "Pending approval", …
   *
   * Status moves batch-wide (every row shares it), so the real screen will very likely
   * render the label twice: once in the batch header and once per decision row. That is a
   * strict-mode violation, not a passing test — scope this to the header region when the
   * screen lands rather than reaching for `.first()`, which would make the assertion true
   * of any occurrence anywhere on the page.
   */
  statusBadge(label: string): Locator {
    return this.page.getByText(label, { exact: true });
  }

  /** One student's decision row, found by the student's visible name. */
  decisionRow(studentName: string): Locator {
    return this.page.getByRole("row", { name: new RegExp(studentName, "i") });
  }

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
}
