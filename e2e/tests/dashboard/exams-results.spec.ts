import { expect, test } from "@/fixtures";
import {
  ALI,
  EXAM_STAFF_NAME,
  examStaff,
  OMAR,
  owner,
  pendingResults,
  principal,
  SARA,
  stubResultsApi,
} from "@/data/exams-results-scenario";
import { uuid } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";

/**
 * An exam's Results tab (PR D) against a stubbed API: the exam author processes (and is refused,
 * with a way to Marks, while marks are outstanding); the principal withholds one result, approves
 * and publishes; a school owner holding both keys who ran the processing finds Approve held for
 * them, and re-processing keeps the withheld result withheld. When the server's state moves
 * behind the screen (another tab re-processed, or sent the results back), a forced approval gets
 * the stub's 422 and a publish before approval its 409, each shown in the confirm dialog. The stub
 * mirrors the server's rules the screens surface (L5); whether the server enforces them is the live
 * lane's (`tests/live/api/exams-results.spec.ts`).
 *
 * Route ownership: `stubResultsApi` (`src/data/exams-results-scenario.ts`) registers
 * `examsScheduleModule`, then `examsResultsModule`, the one owner of `POST /exams/:examAction` and
 * `GET /jobs/:jobId` (a later stub wins), then `examsReportCardsModule`, which owns neither. The
 * Report cards tab and the result register are `exams-report-cards.spec.ts`'s.
 */

const PROCESS_PATH = /\/exams\/[^/]+:process-results$/;
const APPROVE_PATH = /\/exams\/[^/]+:approve-results$/;
const PUBLISH_PATH = /\/exams\/[^/]+:publish-results$/;
// The stub's refusals, in the server's words (`services.py`).
const OWN_RUN_REFUSAL =
  "You ran the processing for this exam, so you cannot also approve it. Results need a second " +
  "pair of eyes (§4).";
const NOT_APPROVED_REFUSAL = "This exam is processing. Only approved results can be published.";

test.describe("the exam author", () => {
  test.use({ authUser: examStaff });

  test("processes the results, which then await someone else's approval", async ({
    page,
    mockApi,
    examResultsPage,
    signedIn: _signedIn,
  }) => {
    const { exam } = stubResultsApi(mockApi, { status: "marks_entry", viewer: examStaff });
    await examResultsPage.gotoResults(exam.id);
    await expect(page.getByText("No results yet", { exact: true })).toBeVisible();

    const process = page.waitForRequest((r) => isApiCall(r, "POST", PROCESS_PATH));
    await examResultsPage.processButton.click();
    expect((await process).headers()["idempotency-key"]).toBeTruthy();
    await expect(page.getByText("3 students' results are ready for approval.")).toBeVisible();

    await expect(examResultsPage.row(ALI)).toContainText("Awaiting approval");
    await expect(examResultsPage.row(ALI)).toContainText("78.00%");
    await expect(examResultsPage.row(SARA)).toContainText("Absent");
    // `exam_staff` holds no approve key (§4: processing, not approval): nothing to approve with.
    await expect(examResultsPage.approveButton).toHaveCount(0);
    await expect(examResultsPage.processButton).toBeVisible();
  });

  test("is refused while marks are outstanding, with a way to the Marks tab", async ({
    mockApi,
    examResultsPage,
    signedIn: _signedIn,
  }) => {
    const { exam } = stubResultsApi(mockApi, {
      status: "marks_entry",
      viewer: examStaff,
      outstanding: ["Mathematics (1 student(s))"],
    });
    await examResultsPage.gotoResults(exam.id);

    await examResultsPage.processButton.click();
    const refusal = examResultsPage.notice(
      "Marks are still outstanding, so results cannot be processed: Mathematics (1 student(s)).",
    );
    await expect(refusal).toBeVisible();
    await expect(refusal.getByRole("link", { name: "Go to Marks" })).toHaveAttribute(
      "href",
      `/exams/${exam.id}?tab=marks`,
    );
    await expect(examResultsPage.processButton).toBeEnabled();
  });
});

test.describe("the principal", () => {
  test.use({ authUser: principal });

  test("withholds one result, approves the others' processing and publishes", async ({
    page,
    mockApi,
    examResultsPage,
    signedIn: _signedIn,
  }) => {
    const processor = { id: uuid(), full_name: EXAM_STAFF_NAME };
    const { exam } = stubResultsApi(mockApi, {
      status: "processing",
      viewer: principal,
      results: (processed, computed) => pendingResults(processed, computed, processor),
    });
    await examResultsPage.gotoResults(exam.id);

    await expect(examResultsPage.processedBy(EXAM_STAFF_NAME)).toBeVisible();
    await expect(examResultsPage.approveButton).toBeEnabled();
    await expect(examResultsPage.processButton).toHaveCount(0);

    // Withheld from publication, with a reason; approval still covers it.
    await examResultsPage.withholdButton(OMAR).click();
    await examResultsPage.withholdReason.fill("Fee dues outstanding.");
    await examResultsPage.confirmWithhold.click();
    await expect(page.getByText(`${OMAR}'s result withheld.`)).toBeVisible();
    await expect(examResultsPage.row(OMAR)).toContainText("Withheld");

    const approve = page.waitForRequest((r) => isApiCall(r, "POST", APPROVE_PATH));
    await examResultsPage.approveButton.click();
    await examResultsPage.confirm("Approve results").click();
    await approve;
    await expect(page.getByText("3 results approved.")).toBeVisible();
    await expect(examResultsPage.row(ALI)).toContainText("Approved");

    // Approved, so Publish replaces Approve.
    await expect(examResultsPage.approveButton).toHaveCount(0);
    const publish = page.waitForRequest((r) => isApiCall(r, "POST", PUBLISH_PATH));
    await examResultsPage.publishButton.click();
    await examResultsPage.confirm("Publish results").click();
    await publish;
    await expect(page.getByText("2 results published; 1 withheld.")).toBeVisible();
    await expect(examResultsPage.row(ALI)).toContainText("Published");
    await expect(examResultsPage.row(SARA)).toContainText("Published");
    await expect(examResultsPage.row(OMAR)).toContainText("Withheld");
    await expect(examResultsPage.row(OMAR)).toContainText("Approved");
  });

  test("sees the server's 409 when the results were sent back before Publish", async ({
    mockApi,
    examResultsPage,
    signedIn: _signedIn,
  }) => {
    const approver = { id: uuid(), full_name: "Sana Iqbal" };
    const { exam } = stubResultsApi(mockApi, {
      status: "approved",
      viewer: principal,
      results: (approved, computed) =>
        pendingResults(approved, computed, examStaff, () => ({
          status: "approved",
          approved_by: approver.id,
          approved_by_name: approver.full_name,
        })),
    });
    await examResultsPage.gotoResults(exam.id);
    await expect(examResultsPage.publishButton).toBeVisible();

    // Another approver sends the results back after the page loaded: approve before publish.
    exam.status = "processing";
    await examResultsPage.publishButton.click();
    await examResultsPage.confirm("Publish results").click();

    await expect(examResultsPage.confirmDialog.getByText(NOT_APPROVED_REFUSAL)).toBeVisible();
  });
});

test.describe("a school owner holding both keys", () => {
  test.use({ authUser: owner });

  test("finds Approve held after processing, and a re-process keeps a withheld result", async ({
    page,
    mockApi,
    examResultsPage,
    signedIn: _signedIn,
  }) => {
    const { exam } = stubResultsApi(mockApi, {
      status: "processing",
      viewer: owner,
      results: (processed, computed) =>
        pendingResults(processed, computed, owner, (row) =>
          row.student_name === OMAR ? { outcome: "withheld" } : {},
        ),
    });
    await examResultsPage.gotoResults(exam.id);

    // §4: the latest processor may not approve, and the button says why.
    await expect(examResultsPage.approveButton).toBeDisabled();
    await expect(examResultsPage.ownRunNote).toBeVisible();
    await expect(examResultsPage.approveButton).toHaveAccessibleDescription(
      "You processed these results, so someone else must approve them.",
    );

    await examResultsPage.processButton.click();
    await expect(page.getByText("3 students' results are ready for approval.")).toBeVisible();
    await expect(examResultsPage.row(OMAR)).toContainText("Withheld");
    await expect(examResultsPage.row(ALI)).toContainText("Pass");
    await expect(examResultsPage.approveButton).toBeDisabled();
  });

  test("sees the server's 422 when a forced approval comes from the latest processor", async ({
    page,
    mockApi,
    examResultsPage,
    signedIn: _signedIn,
  }) => {
    const processor = { id: uuid(), full_name: EXAM_STAFF_NAME };
    const { exam, state } = stubResultsApi(mockApi, {
      status: "processing",
      viewer: owner,
      results: (processed, computed) => pendingResults(processed, computed, processor),
    });
    await examResultsPage.gotoResults(exam.id);
    await expect(examResultsPage.approveButton).toBeEnabled();

    // The owner re-processes in another tab: the server's latest processor is now them.
    for (const row of state.results) {
      row.processed_by = owner.id;
      row.processed_by_name = owner.full_name;
    }
    const approve = page.waitForRequest((r) => isApiCall(r, "POST", APPROVE_PATH));
    await examResultsPage.approveButton.click();
    await examResultsPage.confirm("Approve results").click();
    await approve;

    await expect(examResultsPage.confirmDialog.getByText(OWN_RUN_REFUSAL)).toBeVisible();
  });
});
