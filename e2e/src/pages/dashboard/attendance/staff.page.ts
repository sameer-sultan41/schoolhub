import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

type StaffStatus = "Present" | "Absent" | "Late" | "Half day";

/**
 * `/attendance/staff` — for a holder of the mark key, Register and History tabs
 * (`?view=history`); for anyone else, the history alone. The register is a "Staff" list for
 * `?date=`, one item per staff member with a "Status for {name}" radio group, a check-in time,
 * remarks and its own Save; a checked-in row offers Check out, and a locked row "Request a
 * correction for {name}". The history is a cursor-paged table. See
 * `apps/dashboard/src/features/attendance/staff/`.
 */
export class StaffAttendancePage extends BasePage {
  readonly path = "/attendance/staff";

  /** The page for one date's register (`?date=YYYY-MM-DD`). */
  async gotoDate(date: string): Promise<void> {
    await this.goto({ path: `${this.path}?date=${date}` });
  }

  /** The register's date input, kept in the URL as `?date=`. */
  get date(): Locator {
    return this.page.getByLabel("Date", { exact: true });
  }

  get views(): Locator {
    return this.page.getByRole("tablist", { name: "Staff attendance views" });
  }

  tab(name: "Register" | "History"): Locator {
    return this.page.getByRole("tab", { name, exact: true });
  }

  get staffList(): Locator {
    return this.page.getByRole("list", { name: "Staff", exact: true });
  }

  /** A staff member's register row, holding their controls and any refusal sentence. */
  row(name: string): Locator {
    return this.staffList.getByRole("listitem").filter({ hasText: name });
  }

  statusGroup(name: string): Locator {
    return this.page.getByRole("radiogroup", { name: `Status for ${name}`, exact: true });
  }

  status(name: string, status: StaffStatus): Locator {
    return this.statusGroup(name).getByRole("radio", { name: status, exact: true });
  }

  checkIn(name: string): Locator {
    return this.page.getByLabel(`Check-in time for ${name}`, { exact: true });
  }

  save(name: string): Locator {
    return this.page.getByRole("button", { name: `Save attendance for ${name}`, exact: true });
  }

  checkOut(name: string): Locator {
    return this.page.getByRole("button", { name: `Check out ${name}`, exact: true });
  }

  get checkOutDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Check out" });
  }

  get checkOutTime(): Locator {
    return this.checkOutDialog.getByLabel("Check-out time", { exact: true });
  }

  get checkOutSubmit(): Locator {
    return this.checkOutDialog.getByRole("button", { name: "Record check-out", exact: true });
  }

  requestCorrection(name: string): Locator {
    return this.page.getByRole("button", { name: `Request a correction for ${name}`, exact: true });
  }

  get correctionDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Request a correction" });
  }

  /** A correction input; "Remarks" is there for a student row only, never a staff one. */
  correctionField(label: "Check-in time" | "Check-out time" | "Remarks"): Locator {
    return this.correctionDialog.getByLabel(label, { exact: true });
  }

  get correctionReason(): Locator {
    return this.correctionDialog.getByRole("textbox", { name: "Reason" });
  }

  get correctionSubmit(): Locator {
    return this.correctionDialog.getByRole("button", { name: "Request correction", exact: true });
  }

  get history(): Locator {
    return this.page.getByRole("table", { name: "Staff attendance records" });
  }

  historyRow(text: string | RegExp): Locator {
    return this.history.getByRole("row").filter({ hasText: text });
  }
}
