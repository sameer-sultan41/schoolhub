import { expect, test } from "@/fixtures";
import {
  ALI,
  EXAM_NAME,
  EXAM_STAFF_NAME,
  examStaff,
  OMAR,
  pendingResults,
  principal,
  SARA,
  stubResultsApi,
} from "@/data/exams-results-scenario";
import { uuid } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import { reportCardUrl } from "@/mocks";

/**
 * An exam's Report cards tab and the Reports section's result register (PR D) against a stubbed
 * API: the exam author generates report cards from a published exam and downloads one through its
 * own `:download`; the principal runs the result register. The stub mirrors the server's rules
 * the screens surface (L5); whether the server enforces them is the live lane's
 * (`tests/live/api/exams-results.spec.ts`).
 *
 * Route ownership: `stubResultsApi` (`src/data/exams-results-scenario.ts`) registers
 * `examsScheduleModule`, then `examsResultsModule`, the one owner of `POST /exams/:examAction` and
 * `GET /jobs/:jobId` (a later stub wins), so `:generate-report-cards` and its job reach
 * `examsReportCardsModule` through the state the two share; `examsReportCardsModule` owns
 * `/report-cards` and `/reports/exam-summary`. The Results tab is `exams-results.spec.ts`'s.
 */

const CARD_DOWNLOAD_PATH = /\/report-cards\/[^/]+:download$/;

test.describe("the exam author", () => {
  test.use({ authUser: examStaff });

  test("generates report cards and downloads one through its own link", async ({
    page,
    mockApi,
    examReportCardsPage,
    signedIn: _signedIn,
  }) => {
    const { exam } = stubResultsApi(mockApi, {
      status: "published",
      viewer: examStaff,
      results: (published, computed) =>
        pendingResults(published, computed, examStaff, () => ({ status: "published" })),
    });
    // Storage signs the link with `Content-Disposition: attachment`, which makes Chromium emit
    // the `download` event for a cross-origin link.
    await page.route(reportCardUrl("*"), (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "content-disposition": 'attachment; filename="report-card.pdf"' },
        body: "%PDF-1.4",
      }),
    );
    await examReportCardsPage.gotoReportCards(exam.id);
    await expect(page.getByText("No report cards yet", { exact: true })).toBeVisible();

    await examReportCardsPage.generateButton.click();
    await expect(page.getByText("3 report cards are ready.")).toBeVisible();
    await expect(examReportCardsPage.row(ALI)).toContainText("Generated");

    const linkRequest = page.waitForRequest((r) => isApiCall(r, "POST", CARD_DOWNLOAD_PATH));
    const downloadPromise = page.waitForEvent("download");
    await examReportCardsPage.downloadButton(ALI).click();
    await linkRequest;
    const download = await downloadPromise;
    expect(download.url()).toMatch(/^https:\/\/storage\.e2e\.test\/report-cards\/.+\.pdf$/);
  });
});

test.describe("the principal", () => {
  test.use({ authUser: principal });

  test("runs the result register for an exam", async ({
    mockApi,
    examReportsPage,
    signedIn: _signedIn,
  }) => {
    const processor = { id: uuid(), full_name: EXAM_STAFF_NAME };
    stubResultsApi(mockApi, {
      status: "published",
      viewer: principal,
      results: (published, computed) =>
        pendingResults(published, computed, processor, () => ({ status: "published" })),
    });
    await examReportsPage.goto();

    await examReportsPage.pick("Report", "Result register");
    await examReportsPage.pick("Exam", `${EXAM_NAME} · 2026-27`);
    await examReportsPage.run.click();

    const register = "Result register";
    await expect(examReportsPage.row(register, ALI)).toContainText("78%");
    await expect(examReportsPage.row(register, OMAR)).toContainText("64.5%");
    await expect(examReportsPage.row(register, SARA)).toContainText("Absent");
  });
});
