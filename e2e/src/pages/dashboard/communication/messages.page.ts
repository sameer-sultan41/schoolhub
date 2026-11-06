import type { Locator } from "@playwright/test";
import { CommunicationPage } from "./communication.page";

/**
 * `/communication/messages` — the inbox: a "Conversations" list on the left (a row per thread,
 * with an unread badge), and the open thread on the right, an article named by its subject with a
 * "Messages" list, a "Reply" box with Send and, for a closer, "Close conversation" (or "Reopen"
 * in a closed thread's notice). `?thread=` keeps the open one. See
 * `apps/dashboard/src/features/communication/messages/`.
 */
export class MessagesPage extends CommunicationPage {
  readonly path = "/communication/messages";

  get conversations(): Locator {
    return this.page.getByRole("region", { name: "Conversations" });
  }

  /** A thread's row in the list, found by its subject. */
  threadRow(subject: string): Locator {
    return this.conversations.getByRole("button").filter({ hasText: subject });
  }

  /** The open thread, named by its subject. */
  thread(subject: string): Locator {
    return this.page.getByRole("article", { name: subject });
  }

  get messages(): Locator {
    return this.page.getByRole("list", { name: "Messages", exact: true });
  }

  /** One message bubble, found by its text. */
  message(text: string): Locator {
    return this.messages.getByRole("listitem").filter({ hasText: text });
  }

  get reply(): Locator {
    return this.page.getByRole("textbox", { name: "Reply", exact: true });
  }

  get send(): Locator {
    return this.page.getByRole("button", { name: "Send", exact: true });
  }

  get close(): Locator {
    return this.page.getByRole("button", { name: "Close conversation", exact: true });
  }

  get reopen(): Locator {
    return this.page.getByRole("button", { name: "Reopen", exact: true });
  }

  get closedNotice(): Locator {
    return this.page.getByText("This conversation is closed.", { exact: true });
  }
}
