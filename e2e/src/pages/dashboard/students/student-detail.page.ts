import type { Locator, Page } from "@playwright/test";
import { BasePage } from "../../base.page";
import { StudentRelationsPanel } from "./student-relations.panel";

type DetailTab = "Guardians" | "Emergency contacts" | "Documents" | "History";

/**
 * The student detail sheet — `apps/dashboard/src/features/students/student-detail-sheet.tsx`
 * and its tabs (`student-detail-tabs.tsx`). It has no URL: a directory row opens it
 * (`StudentsPage.openStudent`), on `/students`. The enrollment tab ships as "History"
 * (`tabs.history`), not a separate "Enrollment" label.
 *
 * Everything is scoped to the sheet itself, found by its own name. The sheet is a Radix
 * dialog, so "the dialog" is ambiguous here: the relation tabs' own nested dialogs are
 * dialogs too (see `StudentRelationsPanel`).
 */
export class StudentDetailPage extends BasePage {
  readonly path = "/students";
  /** The relation tabs' actions, scoped to this sheet. */
  readonly relations: StudentRelationsPanel;

  constructor(page: Page) {
    super(page);
    this.relations = new StudentRelationsPanel(page, this.sheet);
  }

  /** Named by its visually hidden title, "{name} — student details". */
  get sheet(): Locator {
    return this.page.getByRole("dialog", { name: /student details$/i });
  }

  tab(name: "Profile" | DetailTab): Locator {
    return this.sheet.getByRole("tab", { name, exact: true });
  }

  /**
   * `ResponsiveTabsList` (`apps/dashboard/src/components/responsive-tabs-list.tsx`) moves
   * whichever trailing tabs don't fit the sheet's width into a "More" dropdown — with
   * every relation tab granted, Documents and History reliably land there. Overflowed
   * items render as `menuitem`s, not `tab`s, so `tab()` alone times out once that
   * happens; this clicks whichever one is actually there. Profile is always first and
   * never overflows, so waiting for it first means the tab list has rendered before the
   * count is taken.
   */
  async openTab(name: DetailTab): Promise<void> {
    await this.tab("Profile").waitFor();
    const tab = this.tab(name);
    if (await tab.count()) {
      await tab.click();
      return;
    }
    await this.sheet.getByRole("button", { name: /^more$/i }).click();
    await this.page.getByRole("menuitem", { name, exact: true }).click();
  }

  /** Escape closes the topmost dialog, which is the sheet once its nested ones are shut. */
  async close(): Promise<void> {
    await this.page.keyboard.press("Escape");
    await this.sheet.waitFor({ state: "hidden" });
  }
}
