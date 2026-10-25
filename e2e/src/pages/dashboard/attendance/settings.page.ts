import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * `/attendance/settings` — the attendance mode (Daily or Period), the lock window and the leave
 * escalation threshold, saved together. See
 * `apps/dashboard/src/features/attendance/settings/`.
 */
export class AttendanceSettingsPage extends BasePage {
  readonly path = "/attendance/settings";

  mode(label: "Daily" | "Period"): Locator {
    return this.page
      .getByRole("radiogroup", { name: "Attendance mode", exact: true })
      .getByRole("radio", { name: label, exact: true });
  }

  get lockWindow(): Locator {
    return this.page.getByLabel("Lock window (days)", { exact: true });
  }

  get save(): Locator {
    return this.page.getByRole("button", { name: "Save", exact: true });
  }
}
