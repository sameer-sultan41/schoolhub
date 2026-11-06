import { expect, test } from "@/fixtures";
import { buildGuardianUser } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  PORTAL_IDS,
  PortalStore,
  buildNotice,
  buildNotification,
  portalModule,
  type MockApi,
} from "@/mocks";

/**
 * A guardian's notices, inbox and notification settings against a stubbed API: acknowledging a
 * notice that asks for it; opening an inbox row marks it read (and the shell's badge follows),
 * and Mark all read covers what is on screen; the preference matrix saves one cell and locks the
 * emergency row. The stub (`portalModule`) answers with the server's shapes (L5) and keeps the
 * state a write changes, so each spec reads the result back from the screen. That a guardian
 * reads only the notices that reached them, and only their own inbox, is the Django suite's job.
 */

const ACKNOWLEDGE_PATH = /\/notices\/[^/]+:acknowledge$/;
const MARK_READ_PATH = /\/notifications\/[^/]+:mark-read$/;
const MARK_ALL_READ_PATH = /\/notifications:mark-all-read$/;
const PREFERENCES_PATH = /\/notification-preferences$/;

const NEWEST_NOTIFICATION_AT = "2026-11-04T10:00:00Z";

/** A fresh server per test: one notice that needs an acknowledgment, two unread notifications. */
function stubInbox(mockApi: MockApi): PortalStore {
  const store = new PortalStore({
    notices: [
      buildNotice(),
      buildNotice({
        id: "00000000-0000-4000-b000-000000000052",
        notice_no: "N-0002",
        title: "Fee circular",
        notice_type: "circular",
        published_at: "2026-10-20T08:00:00Z",
        requires_acknowledgment: false,
      }),
    ],
    notifications: [
      buildNotification(),
      buildNotification({
        id: PORTAL_IDS.attendanceNotification,
        event_key: "attendance.student_absent",
        category: "attendance",
        title: "Absence recorded",
        body: "Ayesha was marked absent on 4 November.",
        created_at: NEWEST_NOTIFICATION_AT,
      }),
    ],
  });
  mockApi.use(portalModule(store));
  return store;
}

test.describe("a guardian's communication pages", () => {
  test.use({ authUser: buildGuardianUser() });

  test("a notice that asks for an acknowledgment can be acknowledged once", async ({
    page,
    mockApi,
    portalPage,
    portalCommunicationPage,
    signedIn: _signedIn,
  }) => {
    const store = stubInbox(mockApi);
    await portalPage.goto();
    await portalPage.tab("Notices").click();

    await expect(portalCommunicationPage.heading).toHaveText("Notices");
    await expect(portalCommunicationPage.notice("Fee circular")).toBeVisible();
    // Only the notice that asks for an acknowledgment is flagged.
    await expect(portalCommunicationPage.needsAcknowledgment).toHaveCount(1);

    await portalCommunicationPage.notice("Sports day").click();
    await expect(portalCommunicationPage.heading).toHaveText("Sports day");
    await expect(page.getByText("Sports day is on Friday.", { exact: true })).toBeVisible();

    const acknowledge = page.waitForRequest((r) => isApiCall(r, "POST", ACKNOWLEDGE_PATH));
    await portalCommunicationPage.acknowledge.click();
    await acknowledge;
    await expect(portalCommunicationPage.acknowledged).toBeVisible();
    await expect(portalCommunicationPage.acknowledge).toHaveCount(0);
    expect(store.acknowledged).toEqual([PORTAL_IDS.notice]);

    // The list no longer flags it.
    await portalCommunicationPage.backToNotices.click();
    await expect(portalCommunicationPage.notice("Sports day")).toBeVisible();
    await expect(portalCommunicationPage.needsAcknowledgment).toHaveCount(0);
  });

  test("opening an inbox row marks it read, and Mark all read covers what is on screen", async ({
    page,
    mockApi,
    portalPage,
    portalCommunicationPage,
    signedIn: _signedIn,
  }) => {
    const store = stubInbox(mockApi);
    await portalPage.goto();
    await expect(portalPage.unreadBadge).toHaveText("2 unread notifications");
    await portalPage.tab("Notifications").click();

    await expect(portalCommunicationPage.heading).toHaveText("Notifications");
    const invoice = portalCommunicationPage.notification("Invoice issued");
    const absence = portalCommunicationPage.notification("Absence recorded");
    await expect(portalCommunicationPage.unreadFlag(invoice)).toBeVisible();
    await expect(portalCommunicationPage.unreadFlag(absence)).toBeVisible();

    const markRead = page.waitForRequest((r) => isApiCall(r, "POST", MARK_READ_PATH));
    await invoice.click();
    await markRead;
    await expect(page.getByText("Invoice INV-0001 is due on 30 November.")).toBeVisible();
    await expect(portalCommunicationPage.unreadFlag(invoice)).toHaveCount(0);
    await expect(portalPage.unreadBadge).toHaveText("1 unread notification");
    expect(store.markedRead).toEqual([PORTAL_IDS.feesNotification]);

    // Everything up to the newest row on screen: that is the cut-off the server is sent.
    const markAll = page.waitForRequest((r) => isApiCall(r, "POST", MARK_ALL_READ_PATH));
    await portalCommunicationPage.markAllRead.click();
    expect((await markAll).postDataJSON()).toEqual({ before: NEWEST_NOTIFICATION_AT });
    await expect(portalCommunicationPage.unreadFlag(absence)).toHaveCount(0);
    await expect(portalPage.unreadBadge).toHaveCount(0);
  });

  test("settings saves one cell and keeps the emergency row on", async ({
    page,
    mockApi,
    portalPage,
    portalCommunicationPage,
    signedIn: _signedIn,
  }) => {
    const store = stubInbox(mockApi);
    await portalPage.goto();
    await portalPage.tab("Settings").click();

    await expect(portalCommunicationPage.heading).toHaveText("Notification settings");
    const feesBySms = portalCommunicationPage.preference("Fees", "SMS");
    await expect(feesBySms).toBeChecked();

    const save = page.waitForRequest((r) => isApiCall(r, "PATCH", PREFERENCES_PATH));
    await feesBySms.click();
    // Only the cell that changed is sent.
    expect((await save).postDataJSON()).toEqual([
      { event_category: "fees", channel: "sms", is_enabled: false },
    ]);
    await expect(feesBySms).not.toBeChecked();
    expect(
      store.preferences.find((row) => row.event_category === "fees" && row.channel === "sms")
        ?.is_enabled,
    ).toBe(false);

    // Emergency notifications cannot be turned off.
    const emergencyByEmail = portalCommunicationPage.preference("Emergency", "Email");
    await expect(emergencyByEmail).toBeChecked();
    await expect(emergencyByEmail).toBeDisabled();
  });
});
