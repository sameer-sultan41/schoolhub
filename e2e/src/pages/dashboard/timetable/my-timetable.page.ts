import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/** `/timetable/my` — the viewer's own week, with a date to show that day's cover. See
 * `apps/dashboard/src/features/timetable/my/my-timetable.tsx`. */
export class MyTimetablePage extends BasePage {
  readonly path = "/timetable/my";

  get table(): Locator {
    return this.page.getByRole("table", { name: "My weekly timetable" });
  }

  get coverDate(): Locator {
    return this.page.getByLabel("Show cover for", { exact: true });
  }
}
