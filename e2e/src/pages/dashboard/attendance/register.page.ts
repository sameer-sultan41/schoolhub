import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

type Status = "Present" | "Absent" | "Late" | "Half day" | "Excused";

/**
 * `/attendance/register` — the date and the Class/Section pickers, My registers' cards ("Open
 * the register for {name}"), then one register: a list of students, each with a "Status for
 * {student}" radio group, a check-in time for a late arrival, and Mark all present and Submit
 * in its footer. A locked row is read-only, with "Request a correction for {student}". See
 * `apps/dashboard/src/features/attendance/register/`.
 */
export class AttendanceRegisterPage extends BasePage {
  readonly path = "/attendance/register";

  get date(): Locator {
    return this.page.getByLabel("Date", { exact: true });
  }

  picker(label: "Class" | "Section" | "Period"): Locator {
    return this.page.getByRole("combobox", { name: label, exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  /** Picks a class, then one of its sections: the register opens on the section. */
  async pickRegister(className: string, sectionName: string): Promise<void> {
    await this.picker("Class").click();
    await this.option(className).click();
    await this.picker("Section").click();
    await this.option(sectionName).click();
  }

  /** A My registers card's button, by the register's name ("Grade 5 · A"). */
  openRegister(name: string): Locator {
    return this.page.getByRole("button", { name: `Open the register for ${name}`, exact: true });
  }

  get students(): Locator {
    return this.page.getByRole("list", { name: "Students", exact: true });
  }

  /** A student's row, holding their status, times, remarks and any refusal sentence. */
  row(student: string): Locator {
    return this.students.getByRole("listitem").filter({ hasText: student });
  }

  statusGroup(student: string): Locator {
    return this.page.getByRole("radiogroup", { name: `Status for ${student}`, exact: true });
  }

  status(student: string, status: Status): Locator {
    return this.statusGroup(student).getByRole("radio", { name: status, exact: true });
  }

  checkIn(student: string): Locator {
    return this.page.getByLabel(`Check-in time for ${student}`, { exact: true });
  }

  get markAllPresent(): Locator {
    return this.page.getByRole("button", { name: "Mark all present", exact: true });
  }

  get submit(): Locator {
    return this.page.getByRole("button", { name: "Submit", exact: true });
  }

  requestCorrection(student: string): Locator {
    return this.page.getByRole("button", {
      name: `Request a correction for ${student}`,
      exact: true,
    });
  }

  get correctionDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Request a correction" });
  }

  get correctionStatus(): Locator {
    return this.correctionDialog.getByRole("combobox", { name: "Status", exact: true });
  }

  get correctionReason(): Locator {
    return this.correctionDialog.getByRole("textbox", { name: "Reason" });
  }

  get correctionSubmit(): Locator {
    return this.correctionDialog.getByRole("button", { name: "Request correction", exact: true });
  }
}
