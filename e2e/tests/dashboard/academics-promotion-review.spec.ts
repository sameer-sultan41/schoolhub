import { expect, test } from "@/fixtures";
import { uuid } from "@/data/factories";
import {
  approver,
  bilal,
  buildBatch,
  grade1,
  grade2,
  grade2SectionA,
  grade2SectionB,
  hamza,
  preparer,
  stubPromotionsApi,
  toGrade2,
  zainab,
} from "@/data/promotion-scenario";
import { isApiCall, type RequestLike } from "@/lib/request-matchers";
import {
  jobsModule,
  type PromotionExecutionReport,
  promotionExecuteJob,
  proposalBasis,
} from "@/mocks";

/**
 * A promotion batch's review screen against a stubbed API: edit a decision, submit (and the
 * refusal while a changed decision has no override reason), approve (and the refusal when the
 * preparer tries), execute and read the report, and the not-found state. The list and its create
 * dialog are `academics-promotions.spec.ts`; both share the world in `@/data/promotion-scenario`.
 *
 * Every transition goes through the page object's `...AndConfirm` methods, the same ones the
 * nightly `live` journey uses, so the PR gate exercises the confirm flow that lane depends on.
 *
 * What this proves is the dashboard's half: the dialogs send the right request, the screens
 * reflect the response, and the buttons gate on the viewer's keys. Whether the server accepts a
 * transition (segregation of duties, the §11 override rule, tenant scoping, what execution does
 * to enrollments) is the API's own test suite and the `live` lane's job; the stub returns what
 * it was told to.
 */

const DECISION_PATH = /\/student-promotions\/[^/]+\/decisions\/[^/]+$/;

/** A colon-action on a batch: `POST /student-promotions/{id}:submit` and its kin. */
function isTransition(request: RequestLike, action: string): boolean {
  return isApiCall(request, "POST", new RegExp(`/student-promotions/[^/]+:${action}$`));
}

test.describe("promotion batch review, preparing a draft", () => {
  test.use({ authUser: preparer });

  test("edits a decision to retained and sends only what changed", async ({
    page,
    mockApi,
    promotionBatchPage,
    signedIn: _signedIn,
  }) => {
    const batch = buildBatch();
    stubPromotionsApi(mockApi, [batch]);
    await promotionBatchPage.gotoBatch(batch.batch_id);
    await expect(promotionBatchPage.statusBadge("Draft")).toBeVisible();

    await promotionBatchPage.editDecision("Hamza Khan").click();
    await expect(promotionBatchPage.decisionDialog).toBeVisible();
    await promotionBatchPage.chooseOption(
      promotionBatchPage.decisionSelect("Decision"),
      "Retained",
    );
    // A retained student stays in the class they are in, so the picker is fixed to it.
    await expect(promotionBatchPage.decisionSelect("Target class")).toContainText("Grade 1");
    await expect(promotionBatchPage.decisionSelect("Target class")).toBeDisabled();

    const request = page.waitForRequest((r) => isApiCall(r, "PATCH", DECISION_PATH));
    await promotionBatchPage.saveDecision.click();

    // Not the unchanged section, reason or remarks, and addressed by student, not by row id.
    const patch = await request;
    expect(patch.postDataJSON()).toEqual({ decision: "retained", to_class_id: grade1.id });
    expect(new URL(patch.url()).pathname).toMatch(
      new RegExp(`/student-promotions/${batch.batch_id}/decisions/${hamza.id}$`),
    );
    await expect(promotionBatchPage.decisionDialog).toBeHidden();
    await expect(promotionBatchPage.decisionRow("Hamza Khan")).toContainText("Retained");
    await expect(promotionBatchPage.decisionRow("Hamza Khan")).toContainText("Grade 1");
    // The other students are as they were.
    await expect(promotionBatchPage.decisionRow("Bilal Ahmed")).toContainText("Promoted");
  });

  test("refuses to submit until a changed decision has an override reason", async ({
    page,
    mockApi,
    promotionBatchPage,
    signedIn: _signedIn,
  }) => {
    // Hamza was proposed for Grade 2 and is retained in Grade 1: that needs a reason.
    const batch = buildBatch({
      decisions: [
        {
          ...toGrade2(hamza),
          decision: "retained",
          to_class_id: grade1.id,
          to_class_name: grade1.name,
          decision_basis: proposalBasis("promoted", grade2.id),
        },
        toGrade2(bilal, grade2SectionA),
      ],
    });
    stubPromotionsApi(mockApi, [batch]);
    await promotionBatchPage.gotoBatch(batch.batch_id);
    await expect(promotionBatchPage.statusBadge("Draft")).toBeVisible();

    await promotionBatchPage.submitForApprovalAndConfirm();

    // The refusal stays in the open dialog, and the batch has not moved.
    await expect(promotionBatchPage.confirmDialog).toHaveAccessibleName(
      "Submit this batch for approval?",
    );
    await expect(promotionBatchPage.confirmDialog).toContainText("Missing for 1 student(s).");
    await expect(promotionBatchPage.statusBadge("Draft")).toBeVisible();
    await promotionBatchPage.cancelConfirm.click();
    await expect(promotionBatchPage.confirmDialog).toBeHidden();

    const reason = "Repeating the year on the principal's advice.";
    await promotionBatchPage.editDecision("Hamza Khan").click();
    await promotionBatchPage.overrideReasonInput.fill(reason);
    const patched = page.waitForRequest((r) => isApiCall(r, "PATCH", DECISION_PATH));
    await promotionBatchPage.saveDecision.click();
    expect((await patched).postDataJSON()).toEqual({ override_reason: reason });
    await expect(promotionBatchPage.decisionDialog).toBeHidden();

    const submitted = page.waitForRequest((r) => isTransition(r, "submit"));
    await promotionBatchPage.submitForApprovalAndConfirm();
    await submitted;

    await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();
    await expect(promotionBatchPage.confirmDialog).toBeHidden();
  });

  test("submits a draft batch for approval through the confirm dialog", async ({
    page,
    mockApi,
    promotionBatchPage,
    signedIn: _signedIn,
  }) => {
    const batch = buildBatch();
    stubPromotionsApi(mockApi, [batch]);
    await promotionBatchPage.gotoBatch(batch.batch_id);
    await expect(promotionBatchPage.statusBadge("Draft")).toBeVisible();

    // A draft offers Submit and Revert, and none of the later steps' buttons.
    await expect(promotionBatchPage.submitForApproval).toBeVisible();
    await expect(promotionBatchPage.revert).toBeVisible();
    await expect(promotionBatchPage.approve).toHaveCount(0);
    await expect(promotionBatchPage.execute).toHaveCount(0);

    const request = page.waitForRequest((r) => isTransition(r, "submit"));
    await promotionBatchPage.submitForApprovalAndConfirm();
    await request;

    await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();
    await expect(promotionBatchPage.confirmDialog).toBeHidden();
    // Once submitted, the decisions are no longer editable and Submit is gone.
    await expect(promotionBatchPage.submitForApproval).toHaveCount(0);
    await expect(promotionBatchPage.editDecisionButtons).toHaveCount(0);
  });
});

test.describe("promotion batch review, approving", () => {
  test.describe("as an approver", () => {
    test.use({ authUser: approver });

    test("sees Approve and Reject but not Submit, and approves the batch", async ({
      page,
      mockApi,
      promotionBatchPage,
      signedIn: _signedIn,
    }) => {
      const batch = buildBatch({ status: "pending_approval" });
      stubPromotionsApi(mockApi, [batch]);
      await promotionBatchPage.gotoBatch(batch.batch_id);
      await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();

      await expect(promotionBatchPage.approve).toBeVisible();
      await expect(promotionBatchPage.reject).toBeVisible();
      // Submit and Revert are the preparer's (`.update`), which this user does not hold.
      await expect(promotionBatchPage.submitForApproval).toHaveCount(0);
      await expect(promotionBatchPage.revert).toHaveCount(0);

      const request = page.waitForRequest((r) => isTransition(r, "approve"));
      await promotionBatchPage.approveAndConfirm();
      await request;

      await expect(promotionBatchPage.statusBadge("Approved")).toBeVisible();
      await expect(promotionBatchPage.confirmDialog).toBeHidden();
      // Executing is `school_admin`'s (`.execute`): the approver is not offered it.
      await expect(promotionBatchPage.execute).toHaveCount(0);
    });
  });

  test.describe("as the preparer", () => {
    test.use({ authUser: preparer });

    test("shows the segregation-of-duties refusal inline and leaves the batch pending", async ({
      mockApi,
      promotionBatchPage,
      signedIn: _signedIn,
    }) => {
      const batch = buildBatch({ status: "pending_approval" });
      stubPromotionsApi(mockApi, [batch], { approverIsPreparer: true });
      await promotionBatchPage.gotoBatch(batch.batch_id);
      await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();

      // The preparer holds the key, so Approve is offered: it is the rule that refuses.
      await promotionBatchPage.approveAndConfirm();

      // The message stays in the open dialog, which can still be confirmed or cancelled.
      await expect(promotionBatchPage.confirmDialog).toContainText(
        "You prepared this batch, so you cannot approve it.",
      );
      await expect(promotionBatchPage.confirm("Approve")).toBeVisible();
      await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();
      // One request: the refusal is shown, not retried.
      expect(mockApi.countCalls("POST", "/student-promotions/:batchAction")).toBe(1);

      await promotionBatchPage.cancelConfirm.click();
      await expect(promotionBatchPage.confirmDialog).toBeHidden();
      await expect(promotionBatchPage.statusBadge("Pending approval")).toBeVisible();
      await expect(promotionBatchPage.approve).toBeVisible();
    });
  });
});

test.describe("promotion batch review, executing", () => {
  test.use({ authUser: preparer });

  test("executes an approved batch and lists the failed student by name", async ({
    page,
    mockApi,
    promotionBatchPage,
    signedIn: _signedIn,
  }) => {
    // Zainab has no target section, which is what fails for her on execute.
    const batch = buildBatch({
      status: "approved",
      decisions: [
        toGrade2(hamza, grade2SectionA),
        toGrade2(bilal, grade2SectionB),
        toGrade2(zainab),
      ],
    });
    const report: PromotionExecutionReport = {
      enrolled: [{ student_id: hamza.id }, { student_id: bilal.id }],
      graduated: [],
      skipped: [],
      failed: [
        {
          student_id: zainab.id,
          error: "Assign a target section before executing this batch.",
        },
      ],
    };
    stubPromotionsApi(mockApi, [batch]);
    mockApi.use(jobsModule({ jobs: promotionExecuteJob(report) }));
    await promotionBatchPage.gotoBatch(batch.batch_id);
    await expect(promotionBatchPage.statusBadge("Approved")).toBeVisible();
    // Said before the run, but an approved batch's sections can no longer be set: the way out is
    // Revert and a new batch, which the notice says.
    await expect(promotionBatchPage.missingSectionsNotice).toContainText(
      "1 student has no target section",
    );
    await expect(promotionBatchPage.missingSectionsNotice).toContainText(
      "revert it and create a new one",
    );

    const request = page.waitForRequest((r) => isTransition(r, "execute"));
    await promotionBatchPage.executeAndConfirm();
    await request;

    // The job runs for two polls: the screen says so, and offers no second run meanwhile.
    await expect(promotionBatchPage.executionProgress(40)).toBeVisible();
    await expect(promotionBatchPage.executeInProgress).toBeDisabled();

    await expect(promotionBatchPage.reportTitle).toBeVisible();
    await expect(promotionBatchPage.reportOutcome("Enrolled in the next session: 2")).toBeVisible();
    await expect(promotionBatchPage.reportOutcome("Failed: 1")).toBeVisible();
    await expect(
      promotionBatchPage.reportEntry(
        "Zainab Ali (ADM-0003): Assign a target section before executing this batch.",
      ),
    ).toBeVisible();
    // The batch reloaded when the job ended. The stub flips every row to executed; a real batch
    // with a failed row has no single status (deferred-work: "A partly failed execute leaves a
    // batch with no status").
    await expect(promotionBatchPage.statusBadge("Executed")).toBeVisible();
    await expect(promotionBatchPage.execute).toHaveCount(0);
  });
});

test.describe("promotion batch review, a batch that is not there", () => {
  test.use({ authUser: preparer });

  test("shows the not-found state with a way back to the list", async ({
    page,
    mockApi,
    promotionBatchPage,
    signedIn: _signedIn,
  }) => {
    stubPromotionsApi(mockApi, [buildBatch()]);

    // A well-formed id no batch has: another school's batch answers the same 404.
    await promotionBatchPage.gotoBatch(uuid());

    await expect(promotionBatchPage.notFoundTitle).toBeVisible();
    await promotionBatchPage.backToList.click();
    await expect(page).toHaveURL(/\/academics\/promotions$/);
  });
});
