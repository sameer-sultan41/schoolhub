import { expect, test } from "@/fixtures";
import {
  COMMUNICATION_INBOX_PERMISSIONS,
  COMMUNICATION_OVERSIGHT_PERMISSIONS,
  COMMUNICATION_READER_PERMISSIONS,
  buildRole,
  buildUser,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  type CommunicationOptions,
  CommunicationStore,
  buildMessage,
  buildThread,
  communicationModule,
  type MockApi,
} from "@/mocks";

/**
 * `/communication/messages` and `/communication/oversight` against a stubbed API: a staff member
 * opens a thread (which marks it read), replies and sees the reply, closes it and finds sending
 * switched off, then reopens it; a reader who may not post never triggers `:mark-read` and gets
 * no reply box; oversight shows the same conversation read-only. The stub (`communicationModule`)
 * answers with the server's shapes and sentences (L5); which threads a user may read, and that
 * oversight writes an audit row, are the Django suite's and the live lane's job.
 */

const POST_MESSAGE_PATH = /\/message-threads\/[^/]+\/messages$/;
const MARK_READ_PATH = /\/message-threads\/[^/]+:mark-read$/;
const CLOSE_PATH = /\/message-threads\/[^/]+:close$/;
const THREAD_PATH = /^\/message-threads|^\/message-thread-oversight/;

const guardianId = uuid();

/** A fresh server per test: an unread thread, a closed one, and their conversations. */
function stubInbox(mockApi: MockApi, options: Pick<CommunicationOptions, "user">) {
  const fees = buildThread({ subject: "Fee reminder", last_message_at: "2026-10-30T09:05:00Z" });
  const trip = buildThread({
    subject: "Trip form",
    status: "closed",
    closed_at: "2026-10-29T10:00:00Z",
    last_message_at: "2026-10-29T10:00:00Z",
  });
  const store = new CommunicationStore({
    ...options,
    threads: [fees, trip],
    messages: {
      [fees.id]: [
        buildMessage(fees.id, {
          sender_id: guardianId,
          body: "Is the term fee due on Friday?",
          sent_at: "2026-10-30T09:00:00Z",
        }),
        buildMessage(fees.id, {
          sender_id: guardianId,
          body: "Please confirm the amount.",
          sent_at: "2026-10-30T09:05:00Z",
        }),
      ],
      [trip.id]: [buildMessage(trip.id, { sender_id: guardianId, body: "Signed form attached." })],
    },
  });
  mockApi.use(communicationModule(store));
  return { store, fees, trip };
}

test.describe("the inbox, as staff who may reply and close", () => {
  const teacher = buildUser({
    id: uuid(),
    full_name: "Imran Siddiqui",
    permissions: COMMUNICATION_INBOX_PERMISSIONS,
    roles: [buildRole({ slug: "teacher", name: "Teacher", scope: "assigned" })],
  });
  test.use({ authUser: teacher });

  test("opens a thread, replies and sees the reply, closes it and cannot send", async ({
    page,
    mockApi,
    messagesPage,
    signedIn: _signedIn,
  }) => {
    const { store, fees } = stubInbox(mockApi, { user: teacher });
    await messagesPage.goto();

    // Two unread messages badge the row until the thread is opened.
    const unread = messagesPage.threadRow("Fee reminder").getByLabel("2 unread");
    await expect(unread).toBeVisible();
    const markRead = page.waitForRequest((r) => isApiCall(r, "POST", MARK_READ_PATH));
    await messagesPage.threadRow("Fee reminder").click();
    await expect(messagesPage.thread("Fee reminder")).toBeVisible();
    await expect(messagesPage.message("Is the term fee due on Friday?")).toContainText(
      "Participant",
    );
    await markRead;
    expect(store.markedRead).toEqual([fees.id]);
    await expect(unread).toHaveCount(0);

    const reply = page.waitForRequest((r) => isApiCall(r, "POST", POST_MESSAGE_PATH));
    await messagesPage.reply.fill("Yes, the fee is due on Friday.");
    await messagesPage.send.click();
    expect((await reply).postDataJSON()).toEqual({
      body: "Yes, the fee is due on Friday.",
      is_internal_note: false,
    });
    await expect(messagesPage.message("Yes, the fee is due on Friday.")).toContainText("You");
    await expect(messagesPage.reply).toHaveValue("");

    // A draft is ready to send until the thread closes.
    await messagesPage.reply.fill("One more thing");
    await expect(messagesPage.send).toBeEnabled();
    const close = page.waitForRequest((r) => isApiCall(r, "POST", CLOSE_PATH));
    await messagesPage.close.click();
    await close;
    await expect(messagesPage.closedNotice).toBeVisible();
    await expect(messagesPage.reply).toBeDisabled();
    await expect(messagesPage.send).toBeDisabled();
    expect(store.thread(fees.id)?.status).toBe("closed");

    await messagesPage.reopen.click();
    await expect(messagesPage.closedNotice).toBeHidden();
    await expect(messagesPage.send).toBeEnabled();
  });

  test("a closed thread opens with sending off and an offer to reopen it", async ({
    messagesPage,
    mockApi,
    signedIn: _signedIn,
  }) => {
    stubInbox(mockApi, { user: teacher });
    await messagesPage.goto();

    await messagesPage.threadRow("Trip form").click();

    await expect(messagesPage.message("Signed form attached.")).toBeVisible();
    await expect(messagesPage.closedNotice).toBeVisible();
    await expect(messagesPage.send).toBeDisabled();
    await expect(messagesPage.close).toBeHidden();
    await expect(messagesPage.reopen).toBeVisible();
  });
});

test.describe("the inbox, as a reader who may not reply", () => {
  const reader = buildUser({
    id: uuid(),
    full_name: "Hina Malik",
    permissions: COMMUNICATION_READER_PERMISSIONS,
    roles: [buildRole({ slug: "reader", name: "Reader", scope: "assigned" })],
  });
  test.use({ authUser: reader });

  test("reads a thread with no reply box and never marks it read", async ({
    mockApi,
    messagesPage,
    signedIn: _signedIn,
  }) => {
    const { store } = stubInbox(mockApi, { user: reader });
    await messagesPage.goto();

    await messagesPage.threadRow("Fee reminder").click();

    await expect(messagesPage.message("Please confirm the amount.")).toBeVisible();
    await expect(messagesPage.reply).toBeHidden();
    await expect(messagesPage.send).toBeHidden();
    await expect(messagesPage.close).toBeHidden();
    // `:mark-read` is keyed on the post permission: a call would only be a 403.
    expect(mockApi.calls.filter((call) => MARK_READ_PATH.test(call.path))).toEqual([]);
    expect(store.markedRead).toEqual([]);
    // The tab bar offers only the inbox.
    await expect(messagesPage.section("Messages")).toBeVisible();
    await expect(messagesPage.section("Oversight")).toBeHidden();
    await expect(messagesPage.section("Broadcast")).toBeHidden();
  });
});

test.describe("oversight", () => {
  const overseer = buildUser({
    id: uuid(),
    full_name: "Ayesha Rahman",
    permissions: COMMUNICATION_OVERSIGHT_PERMISSIONS,
    roles: [buildRole({ slug: "principal", name: "Principal", scope: "all" })],
  });
  test.use({ authUser: overseer });

  test("reads any conversation under an audit banner, with nothing to change it", async ({
    mockApi,
    oversightPage,
    signedIn: _signedIn,
  }) => {
    const { store, trip } = stubInbox(mockApi, { user: overseer });
    await oversightPage.goto();

    await expect(oversightPage.auditBanner).toBeVisible();
    await oversightPage.threadRow("Trip form").click();

    await expect(oversightPage.thread("Trip form")).toBeVisible();
    await expect(oversightPage.message("Signed form attached.")).toBeVisible();
    // Read-only: no reply box, no close, and the thread is never marked read.
    await expect(oversightPage.reply).toBeHidden();
    await expect(oversightPage.close).toBeHidden();
    expect(store.markedRead).toEqual([]);
    expect(store.thread(trip.id)?.status).toBe("closed");
    const writes = mockApi.calls.filter(
      (call) => call.method !== "GET" && THREAD_PATH.test(call.path),
    );
    expect(writes).toEqual([]);
    await expect(oversightPage.section("Oversight")).toBeVisible();
    await expect(oversightPage.section("Messages")).toBeHidden();
  });
});
