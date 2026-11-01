import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import {
  cursorPage,
  FILE_ID,
  ME,
  messageRecord,
  OTHER_THREAD_ID,
  SIGNED_URL,
  THREAD_ID,
  threadRecord,
} from "@/test-fixtures/communication";
import { pick, urlParam } from "@/test-fixtures/list-screen";

import {
  CLOSE_THREAD,
  closeThread,
  CREATE_MESSAGE,
  downloadAttachment,
  fetchThread,
  listMessages,
  listThreads,
  markRead,
  postMessage,
  renderMessages,
  reopenThread,
  stubInbox,
  VIEW,
} from "./messages-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () =>
  jest
    .requireActual<{ communicationServicesMock: () => unknown }>("@/test-fixtures/communication")
    .communicationServicesMock(),
);

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<typeof HelpersModule>("@/lib/helpers"),
  downloadFile: jest.fn(),
}));

const messagesList = () => screen.findByRole("list", { name: "Messages" });

describe("MessagesScreen", () => {
  it("selects thread from URL and marks it read once", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    await renderMessages();

    expect(await screen.findByRole("heading", { name: "Fee query" })).toBeInTheDocument();
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledWith(THREAD_ID);
    });
    // Opening the thread stales its module, so the list (and its unread badge) and the thread
    // are read again...
    await waitFor(() => {
      expect(listThreads).toHaveBeenCalledTimes(2);
      expect(fetchThread).toHaveBeenCalledTimes(2);
    });
    // ...and the refetch does not mark it read a second time.
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("never calls markRead for a reader without the post key", async () => {
    stubInbox([VIEW]);
    await renderMessages();

    expect(await screen.findByRole("heading", { name: "Fee query" })).toBeInTheDocument();
    await messagesList();

    expect(markRead).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument();
  });

  it("renders messages oldest-to-newest from newest-first pages", async () => {
    stubInbox([VIEW]);
    listMessages.mockResolvedValue(
      cursorPage([
        messageRecord({ id: "m3", body: "third", sender_id: ME }),
        messageRecord({ id: "m2", body: "second", is_internal_note: true }),
        messageRecord({ id: "m1", body: "first" }),
      ]),
    );
    await renderMessages();

    const items = within(await messagesList()).getAllByRole("listitem");

    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("first");
    expect(items[1]).toHaveTextContent("second");
    expect(items[2]).toHaveTextContent("third");
    // Who said it: "You" for the signed-in user, a neutral label for anyone else.
    expect(items[2]).toHaveTextContent("You");
    expect(items[0]).toHaveTextContent("Participant");
    expect(items[1]).toHaveTextContent("Internal note");
    expect(items[0]).not.toHaveTextContent("Internal note");
  });

  it("loads earlier messages above the ones on screen", async () => {
    stubInbox([VIEW]);
    listMessages.mockImplementation((_threadId, query) =>
      Promise.resolve(
        query?.cursor === "c2"
          ? cursorPage([messageRecord({ id: "m1", body: "older" })])
          : cursorPage([messageRecord({ id: "m2", body: "newer" })], "c2"),
      ),
    );
    const { user } = await renderMessages();

    await user.click(await screen.findByRole("button", { name: "Load earlier messages" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem"),
      ).toHaveLength(2);
    });
    expect(listMessages).toHaveBeenLastCalledWith(THREAD_ID, { cursor: "c2", pageSize: 30 });
    const items = within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("older");
    expect(items[1]).toHaveTextContent("newer");
  });

  it("reads only the first page again after a post, losing no message", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    listMessages.mockImplementation((_threadId, query) =>
      Promise.resolve(
        query?.cursor === "c2"
          ? cursorPage([messageRecord({ id: "m1", body: "oldest" })])
          : cursorPage([messageRecord({ id: "m2", body: "older" })], "c2"),
      ),
    );
    postMessage.mockResolvedValue(messageRecord());
    const { user } = await renderMessages();
    await user.click(await screen.findByRole("button", { name: "Load earlier messages" }));
    await screen.findByText("oldest");
    listMessages.mockClear();
    // The server now has a newer message, which pushes "older" out of page one's cursor window.
    const newest = messageRecord({ id: "m3", body: "newest" });
    const older = messageRecord({ id: "m2", body: "older" });
    listMessages.mockImplementation(() => Promise.resolve(cursorPage([newest, older], "c3")));

    await user.type(await screen.findByLabelText("Reply"), "Thanks");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("newest");
    await waitFor(() => {
      expect(screen.getByText("older")).toBeInTheDocument();
    });
    // Only the first page is read again: the stale "c2" cursor is not replayed.
    expect(listMessages).toHaveBeenCalled();
    for (const [, query] of listMessages.mock.calls) expect(query?.cursor).toBeUndefined();
    expect(screen.queryByText("oldest")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load earlier messages" })).toBeInTheDocument();
  });

  it("closed thread disables send and shows reopen for permitted user", async () => {
    stubInbox([VIEW, CREATE_MESSAGE, CLOSE_THREAD]);
    fetchThread.mockResolvedValue(threadRecord({ status: "closed" }));
    reopenThread.mockResolvedValue(threadRecord());
    const { user } = await renderMessages();

    expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByLabelText("Reply")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close conversation" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen" }));

    expect(reopenThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it("offers reopen to a viewer who may close but not post", async () => {
    stubInbox([VIEW, CLOSE_THREAD]);
    fetchThread.mockResolvedValue(threadRecord({ status: "closed" }));
    reopenThread.mockResolvedValue(threadRecord());
    const { user } = await renderMessages();

    await user.click(await screen.findByRole("button", { name: "Reopen" }));

    expect(reopenThread).toHaveBeenCalledWith(THREAD_ID);
    expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument();
  });

  it("offers no reopen to a viewer without the close key", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    fetchThread.mockResolvedValue(threadRecord({ status: "closed" }));
    await renderMessages();

    expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("closes an open thread for a viewer with the close key", async () => {
    stubInbox([VIEW, CREATE_MESSAGE, CLOSE_THREAD]);
    closeThread.mockResolvedValue(threadRecord({ status: "closed" }));
    const { user } = await renderMessages();

    await user.click(await screen.findByRole("button", { name: "Close conversation" }));

    expect(closeThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it("posts internal note flag", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    postMessage.mockResolvedValue(messageRecord());
    const { user } = await renderMessages();

    await user.type(await screen.findByLabelText("Reply"), "Check the ledger");
    await user.click(screen.getByRole("checkbox", { name: "Internal note" }));
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(THREAD_ID, {
        body: "Check the ledger",
        is_internal_note: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Reply")).toHaveValue("");
    });
  });

  it("downloads an attachment through the inbox's own endpoint", async () => {
    stubInbox([VIEW]);
    listMessages.mockResolvedValue(cursorPage([messageRecord({ attachments: [FILE_ID] })]));
    downloadAttachment.mockResolvedValue({ download_url: SIGNED_URL });
    const { user } = await renderMessages();

    await user.click(await screen.findByRole("button", { name: "Attachment 1" }));

    await waitFor(() => {
      expect(downloadAttachment).toHaveBeenCalledWith(THREAD_ID, FILE_ID);
    });
    expect(downloadFile).toHaveBeenCalledWith(SIGNED_URL);
  });

  it("thread 404 renders not-found state", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    fetchThread.mockRejectedValue(
      new ApiError({ code: "not_found", message: "Not found.", status: 404, url: "/x" }),
    );
    await renderMessages();

    expect(await screen.findByText("Conversation not found")).toBeInTheDocument();
    expect(markRead).not.toHaveBeenCalled();
  });

  it("shows each conversation's unread count and filters by status in the URL", async () => {
    stubInbox([VIEW]);
    listThreads.mockResolvedValue(
      cursorPage([
        threadRecord({ unread_count: 3 }),
        threadRecord({ id: OTHER_THREAD_ID, subject: "Trip permission" }),
      ]),
    );
    const { user } = await renderMessages();

    expect(await screen.findByLabelText("3 unread")).toBeInTheDocument();
    expect(screen.getByText("Trip permission")).toBeInTheDocument();

    await pick(user, "Status", "Open");

    expect(urlParam("status")).toBe("open");
    expect(urlParam("thread")).toBeNull();
    await waitFor(() => {
      expect(listThreads).toHaveBeenLastCalledWith({
        status: "open",
        cursor: undefined,
        pageSize: 20,
      });
    });
  });
});
