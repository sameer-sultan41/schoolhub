import { expect, test } from "@/fixtures";
import { buildGuardianUser } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  PORTAL_IDS,
  PortalStore,
  buildAttendanceRow,
  buildInvoice,
  buildReceipt,
  buildResult,
  portalModule,
  type MockApi,
} from "@/mocks";

/**
 * A guardian's per-child pages against a stubbed API, reached the way a guardian does it: from
 * `/portal`, through the shell's tab for the selected child. Attendance shows the child's month
 * on the calendar and day by day, with the server's percentage only for the current month
 * (`as_of`); fees lists outstanding and paid invoices, offers a receipt per paid one and has no
 * way to pay; results lists what the API returned, under the exam's term. The stub
 * (`portalModule`) serves the server's shapes (L5) and filters by the child the page asks for,
 * so a sibling's rows showing up would mean the page asked for the wrong child. That unpublished
 * results, drafts and another family's children never reach a guardian is the Django suite's job.
 */

const ATTENDANCE_PATH = /\/student-attendance$/;
const RECEIPT_DOWNLOAD_PATH = /\/receipts\/[^/]+\/download$/;

/** A fresh server per test: Ayesha's November and October, and her sibling's rows to ignore. */
function stubFamily(mockApi: MockApi): PortalStore {
  const store = new PortalStore({
    attendance: [
      buildAttendanceRow(PORTAL_IDS.ayesha, "2026-11-02", "present"),
      buildAttendanceRow(PORTAL_IDS.ayesha, "2026-11-03", "absent"),
      buildAttendanceRow(PORTAL_IDS.ayesha, "2026-11-04", "late"),
      buildAttendanceRow(PORTAL_IDS.ayesha, "2026-10-12", "half_day"),
      buildAttendanceRow(PORTAL_IDS.bilal, "2026-11-05", "on_leave"),
    ],
    invoices: [
      buildInvoice(),
      buildInvoice({
        id: PORTAL_IDS.paidInvoice,
        invoice_no: "INV-0002",
        period_label: "Term 2",
        status: "paid",
        paid_total: "9000.00",
        balance_due: "0.00",
      }),
      buildInvoice({
        id: PORTAL_IDS.bilalInvoice,
        invoice_no: "INV-0003",
        student: PORTAL_IDS.bilal,
        student_name: "Bilal Khan",
      }),
    ],
    receipts: [buildReceipt()],
    results: [
      buildResult(),
      buildResult({
        id: PORTAL_IDS.annual,
        exam_id: PORTAL_IDS.annual,
        exam_name: "Annual",
        term_name: null,
        percentage: "74.00",
        grade: "B",
        rank_in_section: null,
        published_at: "2026-07-01T09:00:00Z",
      }),
      buildResult({
        id: PORTAL_IDS.bilalResult,
        exam_id: PORTAL_IDS.bilalResult,
        exam_name: "Spelling bee",
        student_id: PORTAL_IDS.bilal,
      }),
    ],
  });
  mockApi.use(portalModule(store));
  return store;
}

test.describe("a guardian's child pages", () => {
  test.use({ authUser: buildGuardianUser() });

  test("attendance shows the child's month on the calendar and day by day", async ({
    page,
    mockApi,
    portalPage,
    portalChildPage,
    signedIn: _signedIn,
  }) => {
    stubFamily(mockApi);
    await portalPage.goto();
    await portalPage.tab("Attendance").click();

    await expect(portalChildPage.heading).toHaveText("Attendance");
    await expect(portalChildPage.calendar).toBeVisible();
    await expect(portalChildPage.statusLegend).toBeVisible();

    // The page is for Ayesha: her three days are in the table and her sibling's is not.
    const november = portalChildPage.dayTable("November 2026");
    await expect(november.getByRole("row")).toHaveCount(3);
    await expect(november.getByRole("row").filter({ hasText: "November 2nd, 2026" })).toContainText(
      "Present",
    );
    await expect(november.getByRole("row").filter({ hasText: "November 3rd, 2026" })).toContainText(
      "Absent",
    );
    await expect(november.getByRole("row").filter({ hasText: "November 4th, 2026" })).toContainText(
      "Late",
    );
    await expect(november).not.toContainText("On leave");
    // The server's percentage, shown for the month `as_of` names.
    await expect(portalChildPage.monthPercentage).toHaveText(/^Attendance this month: 96(\.0)?%$/);

    // Another month is fetched for the same child and has no server percentage.
    const october = page.waitForRequest((request) => {
      const query = new URL(request.url()).searchParams;
      return (
        isApiCall(request, "GET", ATTENDANCE_PATH) &&
        query.get("student_id") === PORTAL_IDS.ayesha &&
        query.get("date__gte") === "2026-10-01" &&
        query.get("date__lte") === "2026-10-31"
      );
    });
    await portalChildPage.previousMonth.click();
    await october;
    await expect(portalChildPage.dayTable("October 2026")).toContainText("Half day");
    await expect(portalChildPage.monthPercentage).toHaveCount(0);
  });

  test("fees lists outstanding and paid invoices, downloads a receipt and offers no payment", async ({
    page,
    mockApi,
    portalPage,
    portalChildPage,
    signedIn: _signedIn,
  }) => {
    const store = stubFamily(mockApi);
    await portalPage.goto();
    await portalPage.tab("Fees").click();

    await expect(portalChildPage.heading).toHaveText("Fees");
    await expect(portalChildPage.invoice("INV-0001")).toBeVisible();
    await expect(portalChildPage.invoice("INV-0002")).toBeVisible();
    // Another child's invoice is not on this child's page.
    await expect(portalChildPage.invoice("INV-0003")).toHaveCount(0);
    await expect(portalChildPage.payButton).toHaveCount(0);

    // The PDF is streamed with the bearer token, so it is fetched as a blob and saved.
    const request = page.waitForRequest((r) => isApiCall(r, "GET", RECEIPT_DOWNLOAD_PATH));
    const download = page.waitForEvent("download");
    await portalChildPage.receiptButton("RCP-0001").click();
    expect((await download).suggestedFilename()).toBe("RCP-0001.pdf");
    const sent = await request;
    expect(new URL(sent.url()).pathname).toContain(`/receipts/${PORTAL_IDS.receipt}/download`);
    expect(new URL(sent.url()).searchParams.get("format")).toBe("pdf");
    // The header the stub saw on that GET: Playwright's own view of a cross-origin request's
    // headers is not reliable, and a preflight (never recorded) carries none.
    expect(store.downloadAuthorizations).toHaveLength(1);
    expect(store.downloadAuthorizations[0]).toMatch(/^Bearer \S+/);
  });

  test("results lists the child's published results under their term", async ({
    mockApi,
    portalPage,
    portalChildPage,
    signedIn: _signedIn,
  }) => {
    stubFamily(mockApi);
    await portalPage.goto();
    await portalPage.tab("Results").click();

    await expect(portalChildPage.heading).toHaveText("Results");
    await expect(portalChildPage.termHeading("Term 1")).toBeVisible();
    const midTerm = portalChildPage.result("Mid-term");
    await expect(midTerm).toContainText("81.5%");
    await expect(midTerm).toContainText("rank 3 in section");
    await expect(midTerm).toContainText("Pass");
    // A session-wide exam has no term, so it sits outside the term group.
    await expect(portalChildPage.result("Annual")).toContainText(/74(\.0)?%/);
    await expect(portalChildPage.result("Spelling bee")).toHaveCount(0);
  });
});
