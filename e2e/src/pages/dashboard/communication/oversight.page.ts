import type { Locator } from "@playwright/test";
import { CommunicationPage } from "./communication.page";

/**
 * `/communication/oversight` — every conversation in the school, read-only: the inbox's list and
 * thread view under an audit banner, with no reply box and no close or reopen. See
 * `apps/dashboard/src/features/communication/oversight/`.
 */
export class OversightPage extends CommunicationPage {
  readonly path = "/communication/oversight";

  get auditBanner(): Locator {
    return this.page.getByText(
      "Every conversation or attachment you open here is recorded in the audit log.",
      { exact: true },
    );
  }

  get conversations(): Locator {
    return this.page.getByRole("region", { name: "Conversations" });
  }

  threadRow(subject: string): Locator {
    return this.conversations.getByRole("button").filter({ hasText: subject });
  }

  thread(subject: string): Locator {
    return this.page.getByRole("article", { name: subject });
  }

  message(text: string): Locator {
    return this.page
      .getByRole("list", { name: "Messages", exact: true })
      .getByRole("listitem")
      .filter({ hasText: text });
  }

  get reply(): Locator {
    return this.page.getByRole("textbox", { name: "Reply", exact: true });
  }

  get close(): Locator {
    return this.page.getByRole("button", { name: "Close conversation", exact: true });
  }
}
