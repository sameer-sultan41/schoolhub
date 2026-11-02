import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

export type CommunicationSection = "Messages" | "Oversight" | "Broadcast";

/**
 * What the three Communication screens share: the "Communication sections" tab bar, which lists
 * only the sections the viewer's permissions open. See
 * `apps/dashboard/src/features/communication/communication-sections.ts`.
 */
export abstract class CommunicationPage extends BasePage {
  get sections(): Locator {
    return this.page.getByRole("navigation", { name: "Communication sections" });
  }

  section(name: CommunicationSection): Locator {
    return this.sections.getByRole("link", { name, exact: true });
  }
}
