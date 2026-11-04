import { ApiError } from "@schoolhub/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { MESSAGE_THREADS_QUERY_MODULE } from "@/services/modules/message-threads/message-threads-constant";
import { THREAD_OVERSIGHT_QUERY_MODULE } from "@/services/modules/thread-oversight/thread-oversight-constant";
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
import { buildUser } from "@/test-utils";

import {
  CLOSE_THREAD,
  closeThread,
  CREATE_MESSAGE,
  downloadAttachment,
  fetchCurrentUser,
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

/** A `Conflict` as the envelope carries it: the sentence as its one `non_field` detail. */
function conflict(issue: string) {
  return new ApiError({
    code: "conflict",
    message: issue,
    status: 409,
    url: "/message-threads",
    details: [{ field: "non_field", issue }],
  });
}

/** A lost request, as the client reports one. */
const TIMED_OUT = new ApiError({
  code: "network_error",
  message: "Timed out.",
  status: 0,
  url: "/message-threads",
});

/** Re-reads every inbox query, as a write elsewhere would, and waits for the refetch. */
function reloadThreads(queryClient: QueryClient) {
  return act(() =>
    queryClient.invalidateQueries({ queryKey: queryKeys.module(MESSAGE_THREADS_QUERY_MODULE) }),
  );
}

/** TanStack Query hands results to React on a `setTimeout(0)`: lets the ones queued so far land. */
function flushQueryNotifications() {
  return act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }),
  );
}

describe("MessagesScreen", () => {
  it("selects thread from URL and marks it read once", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    fetchThread.mockResolvedValue(threadRecord({ unread_count: 2 }));
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

  it("marks a thread read again on its next load after a failed call, once", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    fetchThread.mockResolvedValue(threadRecord({ unread_count: 2 }));
    markRead.mockRejectedValueOnce(TIMED_OUT);
    const { queryClient } = await renderMessages();

    expect(await screen.findByRole("heading", { name: "Fee query" })).toBeInTheDocument();
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledTimes(1);
    });
    await messagesList();
    // The failure alone does not loop: it waits for the thread's next load.
    expect(markRead).toHaveBeenCalledTimes(1);

    await reloadThreads(queryClient);
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledTimes(2);
    });
    // The retry succeeded, and its own refetch does not mark the thread read a third time.
    await waitFor(() => {
      expect(fetchThread).toHaveBeenCalledTimes(3);
    });
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it("after a failure, waits for a load newer than one that landed mid-call", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    fetchThread.mockResolvedValue(threadRecord({ unread_count: 2 }));
    let failCall: (error: unknown) => void = () => undefined;
    markRead.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          failCall = reject;
        }),
    );
    const { queryClient } = await renderMessages();
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledTimes(1);
    });

    // The thread reloads, and the view shows the new load, while the call is still in flight...
    const reloaded = "Fee query (reloaded)";
    fetchThread.mockResolvedValue(threadRecord({ unread_count: 2, subject: reloaded }));
    await reloadThreads(queryClient);
    expect(await screen.findByRole("heading", { name: reloaded })).toBeInTheDocument();
    // ...then the call fails, and the mutation's settled state reaches the view.
    await act(async () => {
      failCall(TIMED_OUT);
      await Promise.resolve();
    });
    await flushQueryNotifications();
    // The load on screen is the one the failure happened on: no retry until the next.
    expect(markRead).toHaveBeenCalledTimes(1);

    await reloadThreads(queryClient);
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledTimes(2);
    });
  });

  it("does not mark a thread with nothing unread as read", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    await renderMessages();

    expect(await screen.findByRole("heading", { name: "Fee query" })).toBeInTheDocument();
    await messagesList();

    expect(markRead).not.toHaveBeenCalled();
  });

  it("never calls markRead for a reader without the post key", async () => {
    stubInbox([VIEW]);
    fetchThread.mockResolvedValue(threadRecord({ unread_count: 2 }));
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

  it("keeps the earlier messages the user loaded after a post", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    // A cursor-paged server: newest first, two a page, each cursor naming the last message read.
    const server = [
      messageRecord({ id: "m4", body: "fourth" }),
      messageRecord({ id: "m3", body: "third" }),
      messageRecord({ id: "m2", body: "second" }),
      messageRecord({ id: "m1", body: "first" }),
    ];
    listMessages.mockImplementation((_threadId, query) => {
      const cursor = query?.cursor;
      const start = cursor ? server.findIndex((message) => message.id === cursor) + 1 : 0;
      const items = server.slice(start, start + 2);
      const next = start + 2 < server.length ? (items[items.length - 1]?.id ?? null) : null;
      return Promise.resolve(cursorPage(items, next));
    });
    postMessage.mockImplementation((_threadId, body) => {
      const posted = messageRecord({ id: "m5", body: body.body, sender_id: ME });
      server.unshift(posted);
      return Promise.resolve(posted);
    });
    const { user, queryClient } = await renderMessages();
    await user.click(await screen.findByRole("button", { name: "Load earlier messages" }));
    await screen.findByText("first");
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");

    await user.type(screen.getByLabelText("Reply"), "Thanks");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await within(await messagesList()).findByText("Thanks")).toBeInTheDocument();
    // Both loaded pages are read again, the second from the fresh first page's cursor, so the
    // earlier page the user opened stays on screen...
    expect(listMessages).toHaveBeenLastCalledWith(THREAD_ID, { cursor: "m4", pageSize: 30 });
    expect(screen.getByText("third")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    // ...and the oldest message, pushed onto a third page, is one "Load earlier" away.
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load earlier messages" })).toBeInTheDocument();
    // An inbox write stales oversight's reads of the same thread too.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.module(THREAD_OVERSIGHT_QUERY_MODULE),
    });
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

  it("a close refused with 409 shows the server's sentence and reloads the thread", async () => {
    stubInbox([VIEW, CREATE_MESSAGE, CLOSE_THREAD]);
    fetchThread
      .mockResolvedValueOnce(threadRecord())
      .mockResolvedValue(threadRecord({ status: "closed" }));
    closeThread.mockRejectedValue(conflict("This thread is already closed."));
    const { user } = await renderMessages();

    await user.click(await screen.findByRole("button", { name: "Close conversation" }));

    expect(await screen.findByText("This thread is already closed.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(fetchThread).toHaveBeenCalledTimes(2);
  });

  it("a reply refused with 409 shows the server's sentence and reloads the thread", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    fetchThread
      .mockResolvedValueOnce(threadRecord())
      .mockResolvedValue(threadRecord({ status: "closed" }));
    postMessage.mockRejectedValue(conflict("Reopen the thread to reply."));
    const { user } = await renderMessages();

    await user.type(await screen.findByLabelText("Reply"), "Any news?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Reopen the thread to reply.")).toBeInTheDocument();
    expect(await screen.findByText("This conversation is closed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("offers the internal-note flag only to a staff poster", async () => {
    stubInbox([VIEW, CREATE_MESSAGE]);
    fetchCurrentUser.mockResolvedValue({
      ...buildUser([VIEW, CREATE_MESSAGE]),
      is_restricted_principal: true,
    });
    await renderMessages();

    expect(await screen.findByLabelText("Reply")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Internal note" })).not.toBeInTheDocument();
  });

  it("posts internal note flag", async () => {
    stubInbox([VIEW, CREATE_MESSAGE, CLOSE_THREAD]);
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
