import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

type Decision = "Approve" | "Reject";

/**
 * `/attendance/leave` — student leave requests the viewer may read, pending by default, under
 * Status, Leave type and date filters, paged by Previous and Next. A row opens the request's
 * detail sheet (reason, approval chain, attachment); a request open to the approver carries
 * "Approve/Reject the leave request for {student}", each behind a dialog with an optional note.
 * See `apps/dashboard/src/features/attendance/leave/`.
 */
export class AttendanceLeavePage extends BasePage {
  readonly path = "/attendance/leave";

  get table(): Locator {
    return this.page.getByRole("table", { name: "Student leave requests" });
  }

  row(text: string | RegExp): Locator {
    return this.table.getByRole("row").filter({ hasText: text });
  }

  filter(label: "Status" | "Leave type"): Locator {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** Narrows the queue to one status ("All" shows every status). */
  async filterStatus(name: string): Promise<void> {
    await this.filter("Status").click();
    await this.option(name).click();
  }

  /** A row's Approve or Reject button, named by the request's student. */
  decide(student: string, decision: Decision): Locator {
    return this.page.getByRole("button", {
      name: `${decision} the leave request for ${student}`,
      exact: true,
    });
  }

  dialog(decision: Decision): Locator {
    return this.page.getByRole("dialog", { name: `${decision} leave request` });
  }

  note(decision: Decision): Locator {
    return this.dialog(decision).getByRole("textbox", { name: "Note (optional)" });
  }

  submit(decision: Decision): Locator {
    return this.dialog(decision).getByRole("button", { name: decision, exact: true });
  }

  /** Opens a request's detail by its student cell (the row's buttons decide, not open). */
  async openDetail(student: string): Promise<void> {
    await this.row(student).getByRole("cell").first().click();
  }

  detail(student: string): Locator {
    return this.page.getByRole("dialog", { name: `Leave request for ${student}` });
  }

  /** One level of the detail's approval chain: its decision, approver, date and note. */
  chainStep(student: string, level: number): Locator {
    return this.detail(student)
      .getByRole("listitem")
      .filter({ hasText: `Level ${level}` });
  }

  downloadAttachment(student: string): Locator {
    return this.detail(student).getByRole("button", { name: "Download attachment" });
  }
}
