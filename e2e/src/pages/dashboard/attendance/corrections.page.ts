import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

type Decision = "Approve" | "Reject";

/**
 * `/attendance/corrections` — correction requests the viewer may read, pending by default,
 * under a Status filter and a Mine toggle, paged by Previous and Next. A pending request from
 * someone else carries "Approve/Reject the correction for {student}" for an approver; each opens
 * a dialog with an optional note. See `apps/dashboard/src/features/attendance/corrections/`.
 */
export class AttendanceCorrectionsPage extends BasePage {
  readonly path = "/attendance/corrections";

  get table(): Locator {
    return this.page.getByRole("table", { name: "Attendance correction requests" });
  }

  row(text: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  get status(): Locator {
    return this.page.getByRole("combobox", { name: "Status", exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  get mine(): Locator {
    return this.page.getByRole("checkbox", { name: "Mine", exact: true });
  }

  /** A row's Approve or Reject button, named by the request's student. */
  decide(student: string, decision: Decision): Locator {
    return this.page.getByRole("button", {
      name: `${decision} the correction for ${student}`,
      exact: true,
    });
  }

  dialog(decision: Decision): Locator {
    return this.page.getByRole("dialog", { name: `${decision} correction` });
  }

  note(decision: Decision): Locator {
    return this.dialog(decision).getByRole("textbox", { name: "Note (optional)" });
  }

  submit(decision: Decision): Locator {
    return this.dialog(decision).getByRole("button", { name: decision, exact: true });
  }

  cancel(decision: Decision): Locator {
    return this.dialog(decision).getByRole("button", { name: "Cancel", exact: true });
  }

  /** Narrows the queue to one status ("All" shows every status). */
  async filterStatus(name: string): Promise<void> {
    await this.status.click();
    await this.option(name).click();
  }
}
