import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { seedPromotionBatch } from "@/lib/live-promotion-batch";
import { E2E_PRINCIPAL_EMAIL, E2E_SCHOOL_ADMIN_EMAIL } from "@/lib/seed-constants";

/**
 * Live lane — requires the real stack, seeded (`seed_e2e_data`; see
 * `tests/live/tenant-isolation.spec.ts`'s header for the run command).
 *
 * academics.md §7.2's promotion workflow as two real people at two desks: a
 * `school_admin` prepares and submits a batch, a `principal` approves it, and the
 * `school_admin` — never the approver — executes it. That role split is the module's own
 * control, not a test convention: `services.approve_batch` refuses an approval by the
 * user whose id is on the rows' `created_by`, and §4 gives `.execute` to `school_admin`
 * alone. Two identities are the only way to walk it forward rather than only bounce off it.
 *
 * **The batch's *data* is set up through the API** (`seedPromotionBatch`), not the UI: a
 * batch needs a session pair, a class pair, sections, and a student with a guardian, an
 * emergency contact and an active enrollment before its first row exists. Driving all of
 * that through forms would make this a re-run of the admission journey with a promotion
 * bolted on. What the browser proves here is the part only the browser can: the approval
 * gate is real in the product, not just in the API.
 *
 * **The screens are unbuilt.** The academics dashboard is being written in parallel, so
 * every locator comes from `PromotionBatchPage`, whose header explains where each
 * accessible name is derived from and what to reconcile once the real screen lands.
 *
 * Auth budget (`AuthEndpointThrottle`: 10 requests/minute per IP across
 * login/refresh/logout — e2e/AGENTS.md): 2 browser logins and 3 refreshes, plus the
 * worker-scoped `liveApiClient` login this shares with the API lane. The refreshes are
 * the cold navigations — each `gotoBatch`/`reload` re-boots the app with an empty
 * in-memory access token, which forces one refresh off the rotating cookie. That is the
 * whole reason the second identity gets its own *context* rather than this one signing
 * out and back in twice: sign-out/sign-in would cost a third login plus a logout, on top
 * of the same refreshes.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("promotion approval journey (real API, two identities)", () => {
  test("a batch one user prepares is approved by another, then executed", async ({
    page,
    loginPage,
    dashboardPage,
    promotionBatchPage,
    liveApiClient,
    signInAsSecondIdentity,
  }) => {
    const batch = await seedPromotionBatch(liveApiClient);

    // --- 1. The preparer: `school_admin` submits the draft batch for approval. ---
    await loginPage.goto();
    await loginPage.signIn({
      identifier: E2E_SCHOOL_ADMIN_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");
    // The nav and its permission-gated entries render only after the dashboard's own
    // data loads — same wait `students-admission-enrollment.spec.ts` documents.
    await expect(dashboardPage.heading).toBeVisible();

    await promotionBatchPage.gotoBatch(batch.batchId);
    await expect(promotionBatchPage.statusBadge("Draft")).toBeVisible();
    await promotionBatchPage.submitForApproval.click();
    await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();

    // Segregation of duties, as the user meets it: this identity holds every academics
    // key its role is given *except* `academics.promotion.approve` (seed_e2e_data.py), so
    // the product must not offer it the button at all. The API-level refusal for a user
    // who *does* hold the key is `tests/live/api/academics-promotions.spec.ts`'s job —
    // both halves are needed, because a UI that hides a button it should not offer still
    // has to be backed by a server that refuses the call.
    await expect(promotionBatchPage.approve).toHaveCount(0);

    // --- 2. The approver: a different person, in their own session. ---
    const approver = await signInAsSecondIdentity({
      identifier: E2E_PRINCIPAL_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(approver.page).toHaveURL("/dashboard");
    await expect(approver.dashboardPage.heading).toBeVisible();

    await approver.promotionBatchPage.gotoBatch(batch.batchId);
    await expect(approver.promotionBatchPage.statusBadge("Pending approval")).toBeVisible();
    await approver.promotionBatchPage.approve.click();
    await expect(approver.promotionBatchPage.statusBadge("Approved")).toBeVisible();

    // --- 3. The preparer executes. §4 gives `.execute` to `school_admin`, and the
    // approver deliberately does not hold it — so this cannot be the same session that
    // just approved, and the principal's screen must not offer it either. ---
    await expect(approver.promotionBatchPage.execute).toHaveCount(0);

    // The preparer's context has stayed signed in throughout; it only needs to re-read
    // the batch to see the approval that happened elsewhere.
    await page.reload();
    await expect(promotionBatchPage.statusBadge("Approved")).toBeVisible();
    await promotionBatchPage.execute.click();

    // Executed is terminal for a batch that produced enrollments: `revert_batch` refuses
    // once the next-session enrollments exist, which is exactly what just happened.
    await expect(promotionBatchPage.statusBadge("Executed")).toBeVisible();
  });
});
