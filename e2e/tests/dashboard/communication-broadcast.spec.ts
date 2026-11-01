import { expect, test } from "@/fixtures";
import {
  COMMUNICATION_BROADCAST_PERMISSIONS,
  COMMUNICATION_READER_PERMISSIONS,
  buildRole,
  buildUser,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  type CommunicationOptions,
  CommunicationStore,
  buildSchoolClass,
  buildSection,
  communicationModule,
  jobsModule,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * `/communication/broadcast` against a stubbed API: a sender previews an audience of 42, types
 * 42 and sends, and the job succeeds; an audience that shrank between the preview and the send
 * gets the server's 409 with the new count in `error.meta`, re-previews, and sends on the new
 * number; a section audience picks its class first; a user without the send key sees no
 * Broadcast tab. The stub (`communicationModule`) compares a send with the audience as it stands
 * (the real 409) and queues the job `jobsModule` serves (L5); who a real audience resolves to,
 * the campus scope and the idempotent replay are the Django suite's job.
 */

const PREVIEW_PATH = /\/broadcasts:preview$/;
const EMERGENCY_PATH = /\/broadcasts:emergency$/;

const MESSAGE = "School closes at noon today because of the storm.";

const sender = buildUser({
  id: uuid(),
  full_name: "Ayesha Rahman",
  permissions: COMMUNICATION_BROADCAST_PERMISSIONS,
  roles: [buildRole({ slug: "principal", name: "Principal", scope: "all" })],
});

const gradeFive = buildSchoolClass({ name: "Grade 5" });
const sectionA = buildSection({ name: "A", class_id: gradeFive.id });

/** A fresh server per test: an audience of 42 reached in-app, with SMS not delivered. */
function stubBroadcast(mockApi: MockApi, options: Partial<CommunicationOptions> = {}) {
  const store = new CommunicationStore({
    user: sender,
    recipientCount: 42,
    audienceDigest: "digest-42",
    channels: ["in_app"],
    unavailableChannels: ["sms"],
    ...options,
  });
  mockApi.use(
    schoolOrganizationModule({ classes: [gradeFive], sections: [sectionA] }),
    communicationModule(store),
    jobsModule(store.jobsOptions()),
  );
  return store;
}

test.describe("the emergency broadcast, as a sender", () => {
  test.use({ authUser: sender });

  test("previews 42, types 42, sends, and the job succeeds", async ({
    page,
    mockApi,
    broadcastPage,
    signedIn: _signedIn,
  }) => {
    const store = stubBroadcast(mockApi);
    await broadcastPage.goto();

    await broadcastPage.audience("Everyone").check();
    await broadcastPage.next.click();
    await broadcastPage.message.fill(MESSAGE);
    await broadcastPage.next.click();

    // The preview names who is reached, with channel names rather than ids (L32).
    await expect(broadcastPage.recipients("42 recipients")).toBeVisible();
    await expect(page.getByText("In-app", { exact: true })).toBeVisible();
    await expect(page.getByText("SMS: not delivered, no provider")).toBeVisible();
    expect(store.previews).toEqual([{ audience_type: "all", message: MESSAGE }]);

    // Sending is armed only by the exact count.
    await expect(broadcastPage.send).toBeDisabled();
    await broadcastPage.confirmCount.fill("41");
    await expect(broadcastPage.send).toBeDisabled();
    await broadcastPage.confirmCount.fill("42");
    await expect(broadcastPage.send).toBeEnabled();

    const send = page.waitForRequest((r) => isApiCall(r, "POST", EMERGENCY_PATH));
    await broadcastPage.send.click();
    const request = await send;

    expect(request.postDataJSON()).toEqual({
      audience_type: "all",
      message: MESSAGE,
      confirm_recipient_count: 42,
      audience_digest: "digest-42",
    });
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    await expect(broadcastPage.result).toHaveText("The broadcast was sent to 42 recipients.");
  });

  test("an audience that changed after the preview is refused, re-previewed and sent on the new count", async ({
    page,
    mockApi,
    broadcastPage,
    signedIn: _signedIn,
  }) => {
    const store = stubBroadcast(mockApi);
    await broadcastPage.goto();
    await broadcastPage.next.click();
    await broadcastPage.message.fill(MESSAGE);
    await broadcastPage.next.click();
    await expect(broadcastPage.recipients("42 recipients")).toBeVisible();

    // Two people left the audience while the sender was reading the preview.
    store.recipientCount = 40;
    store.audienceDigest = "digest-40";
    await broadcastPage.confirmCount.fill("42");
    await broadcastPage.send.click();

    await expect(
      page.getByText(
        "The audience changed and now has 40 recipients. Check it, then type the new number.",
      ),
    ).toBeVisible();
    await expect(broadcastPage.recipients("40 recipients")).toBeVisible();
    await expect(broadcastPage.confirmCount).toHaveValue("");
    await expect(broadcastPage.send).toBeDisabled();
    expect(store.jobs).toEqual({});

    await broadcastPage.confirmCount.fill("40");
    const send = page.waitForRequest((r) => isApiCall(r, "POST", EMERGENCY_PATH));
    await broadcastPage.send.click();

    expect((await send).postDataJSON()).toMatchObject({
      confirm_recipient_count: 40,
      audience_digest: "digest-40",
    });
    await expect(broadcastPage.result).toHaveText("The broadcast was sent to 40 recipients.");
    // A different count and digest is a different send, so it carries a new key.
    const [first, second] = store.sends;
    expect(first?.key).toBeTruthy();
    expect(second?.key).toBeTruthy();
    expect(second?.key).not.toBe(first?.key);
  });

  test("a section audience picks its class first, then its sections", async ({
    page,
    mockApi,
    broadcastPage,
    signedIn: _signedIn,
  }) => {
    const store = stubBroadcast(mockApi);
    await broadcastPage.goto();

    await broadcastPage.audience("Specific sections").check();
    await expect(broadcastPage.checkbox("A")).toBeHidden();
    await broadcastPage.next.click();
    await expect(page.getByText("Choose at least one section.")).toBeVisible();

    await broadcastPage.sectionClass.click();
    await broadcastPage.option("Grade 5").click();
    await broadcastPage.checkbox("A").check();
    await broadcastPage.next.click();
    await broadcastPage.message.fill(MESSAGE);
    await broadcastPage.next.click();

    await expect(broadcastPage.recipients("42 recipients")).toBeVisible();
    const [preview] = store.previews;
    // The class only narrows the picker: the API sees the section ids alone.
    expect(preview).toEqual({
      audience_type: "section",
      audience_filter: { section_ids: [sectionA.id] },
      message: MESSAGE,
    });

    // Back to the message and forward again re-previews the same request.
    await broadcastPage.back.click();
    await broadcastPage.next.click();
    await expect(broadcastPage.recipients("42 recipients")).toBeVisible();
    expect(store.previews[store.previews.length - 1]).toEqual(preview);
  });
});

test.describe("the emergency broadcast, without the send key", () => {
  const reader = buildUser({
    id: uuid(),
    full_name: "Hina Malik",
    permissions: COMMUNICATION_READER_PERMISSIONS,
    roles: [buildRole({ slug: "reader", name: "Reader", scope: "assigned" })],
  });
  test.use({ authUser: reader });

  test("sees no Broadcast tab", async ({ mockApi, messagesPage, signedIn: _signedIn }) => {
    mockApi.use(communicationModule(new CommunicationStore({ user: reader })));
    await messagesPage.goto();

    await expect(messagesPage.section("Messages")).toBeVisible();
    await expect(messagesPage.section("Broadcast")).toBeHidden();
    expect(mockApi.calls.filter((call) => PREVIEW_PATH.test(call.path))).toEqual([]);
  });
});
