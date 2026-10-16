import { expect, test } from "@/fixtures";
import {
  buildBatch,
  closedSession,
  currentSession,
  grade1,
  grade2,
  nextSession,
  preparer,
  stubPromotionsApi,
  viewOnlyUser,
} from "@/data/promotion-scenario";
import { isApiCall, type RequestLike } from "@/lib/request-matchers";

/**
 * The `/academics/promotions` list against a stubbed API: the viewer-key gating, creating a batch
 * and landing on its page, opening a batch and coming back, and the status filter with its URL
 * state. A batch's own screen is `academics-promotion-review.spec.ts`; both share the world in
 * `@/data/promotion-scenario`.
 *
 * What this proves is the dashboard's half: the dialog sends the right request, the screens
 * reflect the response, and the buttons gate on the viewer's keys. Whether the server accepts a
 * create (a batch already exists, the session lock, tenant scoping) is the API's own test suite
 * and the `live` lane's job; the stub returns what it was told to.
 */

const COLLECTION_PATH = /\/student-promotions$/;

/** The batch list read, with the `status` filter it was asked for. */
function isListCall(request: RequestLike, status: string): boolean {
  return (
    isApiCall(request, "GET", COLLECTION_PATH) &&
    new URL(request.url()).searchParams.get("status") === status
  );
}

test.describe("promotions with only the promotion view key", () => {
  test.use({ authUser: viewOnlyUser });

  test("sends /academics to Promotions, with no New batch button", async ({
    page,
    mockApi,
    dashboardPage,
    promotionsPage,
    signedIn: _signedIn,
  }) => {
    stubPromotionsApi(mockApi, [buildBatch()]);

    // `/academics` has no page of its own: it sends the viewer to their first section.
    await dashboardPage.goto({ path: "/academics" });

    await expect(page).toHaveURL(/\/academics\/promotions$/);
    await expect(promotionsPage.heading).toHaveText("Promotions");
    // The tab bar lists only the section this key opens, and it shows once the viewer's keys
    // are known, which is what makes the missing button below meaningful.
    await expect(dashboardPage.sectionTab("Promotions")).toBeVisible();
    await expect(dashboardPage.sectionTab("Curriculum")).toHaveCount(0);
    await expect(dashboardPage.sectionTab("Teacher allocation")).toHaveCount(0);
    await expect(promotionsPage.row("Grade 1", "Draft")).toBeVisible();
    // The same stubs give the preparer all of these (the tests below).
    await expect(promotionsPage.newBatchButton).toHaveCount(0);
  });
});

test.describe("promotion batch list", () => {
  test.use({ authUser: preparer });

  test("creates a batch and lands on its review page", async ({
    page,
    mockApi,
    promotionsPage,
    promotionBatchPage,
    signedIn: _signedIn,
  }) => {
    // No Grade 1 batch yet: the stub refuses a second one for the same class and sessions.
    stubPromotionsApi(mockApi, []);
    await promotionsPage.goto();
    await expect(promotionsPage.newBatchButton).toBeEnabled();

    await promotionsPage.newBatchButton.click();
    await expect(promotionsPage.createDialog).toBeVisible();
    // The source defaults to the current session.
    await expect(promotionsPage.createSelect("From session")).toContainText("2026-27");
    // The target is neither the source nor a closed session: the API would refuse both.
    await promotionsPage.createSelect("To session").click();
    await expect(promotionsPage.option("2027-28")).toBeVisible();
    await expect(promotionsPage.option("2026-27")).toHaveCount(0);
    await expect(promotionsPage.option("2025-26")).toHaveCount(0);
    await promotionsPage.option("2027-28").click();
    await promotionsPage.chooseOption(promotionsPage.createSelect("Class"), "Grade 1");

    const request = page.waitForRequest((r) => isApiCall(r, "POST", COLLECTION_PATH));
    await promotionsPage.createSubmit.click();

    expect((await request).postDataJSON()).toEqual({
      from_academic_session_id: currentSession.id,
      to_academic_session_id: nextSession.id,
      class_id: grade1.id,
    });
    await expect(promotionsPage.createdToast(3)).toBeVisible();
    await expect(page).toHaveURL(/\/academics\/promotions\/[0-9a-f-]{36}$/);
    await expect(promotionBatchPage.heading).toHaveText("Promotion batch");
    await expect(promotionBatchPage.statusBadge("Draft")).toBeVisible();
    await expect(promotionBatchPage.sessionPair("2026-27", "2027-28")).toBeVisible();
    // The stub proposes Grade 2 and no section for each student.
    await expect(promotionBatchPage.decisionRow("Hamza Khan")).toContainText("Grade 2");
    await expect(promotionBatchPage.missingSectionsNotice).toContainText(
      "3 students have no target section",
    );
  });

  test("opens a batch from its link and comes back", async ({
    page,
    mockApi,
    promotionsPage,
    promotionBatchPage,
    signedIn: _signedIn,
  }) => {
    const pending = buildBatch({
      status: "pending_approval",
      from_class_id: grade2.id,
      from_class_name: "Grade 2",
    });
    stubPromotionsApi(mockApi, [buildBatch(), pending]);
    await promotionsPage.goto();

    // Two sessions' batches can share a class, so a link is named by both.
    await promotionsPage.batchLink("Grade 2", "2026-27", "2027-28").click();

    await expect(page).toHaveURL(new RegExp(`/academics/promotions/${pending.batch_id}$`));
    await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();

    await promotionBatchPage.backToList.click();
    await expect(page).toHaveURL(/\/academics\/promotions$/);
    await expect(promotionsPage.row("Grade 1", "Draft")).toBeVisible();
  });

  test("filters by status, and a reload keeps the filter and the request", async ({
    page,
    mockApi,
    promotionsPage,
    signedIn: _signedIn,
  }) => {
    const pending = buildBatch({
      status: "pending_approval",
      from_class_id: grade2.id,
      from_class_name: "Grade 2",
    });
    const executed = buildBatch({
      status: "executed",
      from_academic_session_id: closedSession.id,
      from_academic_session_name: "2025-26",
      to_academic_session_id: currentSession.id,
      to_academic_session_name: "2026-27",
    });
    stubPromotionsApi(mockApi, [buildBatch(), pending, executed]);
    await promotionsPage.goto();
    await expect(promotionsPage.row("Grade 1", "Draft")).toBeVisible();
    await expect(promotionsPage.row("Executed")).toBeVisible();

    const filtered = page.waitForRequest((r) => isListCall(r, "pending_approval"));
    await promotionsPage.chooseOption(promotionsPage.filter("Status"), "Pending approval");
    await filtered;

    await expect(page).toHaveURL(/[?&]status=pending_approval(&|$)/);
    await expect(promotionsPage.row("Grade 2", "Pending approval")).toBeVisible();
    await expect(promotionsPage.row("Draft")).toHaveCount(0);
    await expect(promotionsPage.row("Executed")).toHaveCount(0);

    const afterReload = page.waitForRequest((r) => isListCall(r, "pending_approval"));
    await page.reload();

    await expect(promotionsPage.filter("Status")).toContainText("Pending approval");
    await expect(promotionsPage.row("Grade 2", "Pending approval")).toBeVisible();
    await expect(promotionsPage.row("Draft")).toHaveCount(0);
    // The same address asks the API for the same list.
    const query = new URL((await afterReload).url()).searchParams;
    expect(query.get("status")).toBe("pending_approval");
  });
});
