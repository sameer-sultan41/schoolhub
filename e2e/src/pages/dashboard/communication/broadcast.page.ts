import type { Locator } from "@playwright/test";
import { CommunicationPage } from "./communication.page";

/**
 * `/communication/broadcast` — the Emergency broadcast wizard: Audience (a radio per audience
 * type, a Campus filter and, for classes or sections, their pickers), Message, Confirm (the
 * previewed recipient count, the channels, and a "Type N to confirm" box that arms "Send
 * emergency broadcast"), then Status. See
 * `apps/dashboard/src/features/communication/broadcast/`.
 */
export class BroadcastPage extends CommunicationPage {
  readonly path = "/communication/broadcast";

  audience(name: string): Locator {
    return this.page.getByRole("radio", { name, exact: true });
  }

  get next(): Locator {
    return this.page.getByRole("button", { name: "Next", exact: true });
  }

  get back(): Locator {
    return this.page.getByRole("button", { name: "Back", exact: true });
  }

  /** The campus the broadcast is narrowed to: every campus or one, or a restricted sender's own. */
  get campus(): Locator {
    return this.page.getByRole("combobox", { name: "Campus", exact: true });
  }

  /** The class the section audience picks sections from. */
  get sectionClass(): Locator {
    return this.page.getByRole("combobox", { name: "Class", exact: true });
  }

  option(name: string): Locator {
    return this.page.getByRole("option", { name, exact: true });
  }

  checkbox(name: string): Locator {
    return this.page.getByRole("checkbox", { name, exact: true });
  }

  get message(): Locator {
    return this.page.getByRole("textbox", { name: "Message", exact: true });
  }

  /** The "Type N to confirm …" box. */
  get confirmCount(): Locator {
    return this.page.getByRole("textbox", { name: /^Type \d+ to confirm/ });
  }

  get send(): Locator {
    return this.page.getByRole("button", { name: "Send emergency broadcast", exact: true });
  }

  /** The previewed count, "42 recipients". */
  recipients(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  /** The finished job's line, "The broadcast was sent to 42 recipients." */
  get result(): Locator {
    return this.page.getByRole("status");
  }
}
