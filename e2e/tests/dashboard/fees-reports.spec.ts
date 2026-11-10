import { expect, test } from "@/fixtures";
import {
  buildRole,
  buildUser,
  FEES_REPORTS_ACCOUNTANT_PERMISSIONS,
  FEES_REPORTS_PRINCIPAL_PERMISSIONS,
  ORG_IDS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildAcademicSession,
  buildCampus,
  buildSchoolClass,
  type CollectionSeed,
  feesReportsModule,
  FinanceReportsState,
  type FinanceReportsOptions,
  jobsModule,
  type MockApi,
  REPORT_EXPORT_GLOB,
  schoolOrganizationModule,
  todayUtc,
} from "@/mocks";

/**
 * Reports (PR E) against a stubbed API: an accountant opens on today's collection, groups it by
 * cashier for §6's register, narrows it by campus, switches to the aging and the statement, and
 * exports a report too large to show; a principal reads the reports and is offered no export.
 * The stub (`feesReportsModule`) enforces the server's rules the screen surfaces (L5): a filter on
 * a kind with no such dimension is a 400, a statement needs its student, a report over the
 * ceiling is a 422 carrying `meta.row_limit`. Whether the server narrows and sums as the screen
 * assumes is the live lane's (`tests/live/api/fees-reports.spec.ts`).
 */

const REPORT_PATH = /\/reports\/finance-summary$/;

const mainCampus = buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" });
const northCampus = buildCampus({
  id: ORG_IDS.northCampus,
  name: "North Campus",
  is_primary: false,
});
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const currentSession = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });

const CASHIER = "5a5a5a5a-0000-4000-8000-000000000001";
const STUDENT = "57d57d57-0000-4000-8000-000000000001";

const accountant = buildUser({
  id: uuid(),
  roles: [buildRole({ slug: "accountant", name: "Accountant" })],
  permissions: FEES_REPORTS_ACCOUNTANT_PERMISSIONS,
});
const principal = buildUser({
  id: uuid(),
  roles: [buildRole({ slug: "principal", name: "Principal" })],
  permissions: FEES_REPORTS_PRINCIPAL_PERMISSIONS,
});

function payment(overrides: Partial<CollectionSeed>): CollectionSeed {
  return {
    day: todayUtc(),
    method: "cash",
    received_by: CASHIER,
    amount: "1000.00",
    campus_id: ORG_IDS.mainCampus,
    academic_session_id: ORG_IDS.currentSession,
    class_id: ORG_IDS.grade1,
    ...overrides,
  };
}

function stubReports(mockApi: MockApi, options: FinanceReportsOptions) {
  const state = new FinanceReportsState(options);
  mockApi.use(
    schoolOrganizationModule({
      campuses: [mainCampus, northCampus],
      classes: [grade1],
      academicSessions: [currentSession],
    }),
    feesReportsModule(state),
    jobsModule(state.jobsOptions()),
  );
  return state;
}

test.describe("an accountant reading the reports", () => {
  test.use({ authUser: accountant });

  test("opens on today's collection, then groups it by cashier for the register", async ({
    page,
    mockApi,
    feeReportsPage,
    signedIn: _signedIn,
  }) => {
    stubReports(mockApi, {
      permissions: FEES_REPORTS_ACCOUNTANT_PERMISSIONS,
      payments: [
        payment({ amount: "1000.00" }),
        payment({ amount: "500.00", method: "bank_transfer" }),
        payment({ amount: "250.00", received_by: null, method: "card" }),
        // Yesterday's money is not today's collection.
        payment({ amount: "9999.00", day: "2020-01-01" }),
      ],
    });

    await feeReportsPage.goto();

    await expect(feeReportsPage.row("Collection", "1,750.00")).toBeVisible();
    await feeReportsPage.choose("Group by", "Cashier");
    await expect(page).toHaveURL(/group=cashier/);
    await expect(feeReportsPage.row("Collection", "5a5a5a5a")).toContainText("1,500.00");
    await expect(feeReportsPage.row("Collection", "Online or system")).toContainText("250.00");
  });

  test("narrows the collection by campus, and sends the filter to the server", async ({
    page,
    mockApi,
    feeReportsPage,
    signedIn: _signedIn,
  }) => {
    const state = stubReports(mockApi, {
      permissions: FEES_REPORTS_ACCOUNTANT_PERMISSIONS,
      payments: [
        payment({ amount: "1000.00", campus_id: ORG_IDS.mainCampus }),
        payment({ amount: "400.00", campus_id: ORG_IDS.northCampus }),
      ],
    });
    await feeReportsPage.goto();
    await expect(feeReportsPage.row("Collection", "1,400.00")).toBeVisible();

    const request = page.waitForRequest(
      (r) => isApiCall(r, "GET", REPORT_PATH) && r.url().includes("campus_id"),
    );
    await feeReportsPage.choose("Campus", "North Campus");

    expect((await request).url()).toContain(`campus_id=${ORG_IDS.northCampus}`);
    await expect(page).toHaveURL(new RegExp(`campus=${ORG_IDS.northCampus}`));
    await expect(feeReportsPage.row("Collection", "400.00")).toBeVisible();
    await expect(feeReportsPage.row("Collection", "1,400.00")).toHaveCount(0);
    expect(state.runs.at(-1)).toMatchObject({ kind: "collection", campus_id: ORG_IDS.northCampus });
  });

  test("switches to the outstanding balances and offers only the filters that report takes", async ({
    page,
    mockApi,
    feeReportsPage,
    signedIn: _signedIn,
  }) => {
    stubReports(mockApi, {
      permissions: FEES_REPORTS_ACCOUNTANT_PERMISSIONS,
      rows: {
        "outstanding-aging": [
          {
            student_id: STUDENT,
            row: {
              kind: "outstanding-aging",
              student_id: STUDENT,
              admission_number: "ADM-1001",
              first_name: "Aisha",
              last_name: "Khan",
              total_outstanding: "4000.00",
              invoice_count: 4,
              not_yet_due: "1000.00",
              bucket_0_30: "500.00",
              bucket_31_60: "750.25",
              bucket_61_90: "1249.75",
              bucket_90_plus: "500.00",
            },
          },
        ],
      },
    });
    await feeReportsPage.goto();

    await feeReportsPage.choose("Report", "Outstanding and aging");

    await expect(page).toHaveURL(/kind=outstanding-aging/);
    const row = feeReportsPage.row("Outstanding and aging", "Aisha Khan");
    await expect(row).toContainText("4,000.00");
    await expect(row).toContainText("1,249.75");
    await expect(feeReportsPage.dateInput("As of")).toBeVisible();
    await expect(feeReportsPage.select("Campus")).toBeVisible();

    await feeReportsPage.choose("Report", "Trial balance");
    await expect(feeReportsPage.select("Campus")).toHaveCount(0);
    await expect(feeReportsPage.select("Class")).toHaveCount(0);
  });

  test("shows a student's statement from a link, each line with the server's balance", async ({
    mockApi,
    feeReportsPage,
    signedIn: _signedIn,
  }) => {
    stubReports(mockApi, {
      permissions: FEES_REPORTS_ACCOUNTANT_PERMISSIONS,
      rows: {
        "student-ledger": [
          {
            student_id: STUDENT,
            row: {
              kind: "student-ledger",
              entry_type: "invoice",
              date: "2026-08-01",
              reference: "INV-0001",
              description: "2026-09",
              debit: "1000.00",
              credit: "0.00",
              balance: "1000.00",
            },
          },
          {
            student_id: STUDENT,
            row: {
              kind: "student-ledger",
              entry_type: "payment",
              date: "2026-10-01",
              reference: "RCP-0007",
              description: "Cash",
              debit: "0.00",
              credit: "400.00",
              balance: "600.00",
            },
          },
          {
            student_id: uuid(),
            row: {
              kind: "student-ledger",
              entry_type: "invoice",
              date: "2026-08-01",
              reference: "INV-OTHER",
              description: "Someone else",
              debit: "7.00",
              credit: "0.00",
              balance: "7.00",
            },
          },
        ],
      },
    });

    await feeReportsPage.goto({ path: `/fees/reports?kind=student-ledger&student=${STUDENT}` });

    await expect(feeReportsPage.row("Student statement", "RCP-0007")).toContainText("600.00");
    await expect(feeReportsPage.row("Student statement", "INV-0001")).toContainText("1,000.00");
    await expect(feeReportsPage.row("Student statement", "INV-OTHER")).toHaveCount(0);
  });

  test("offers to export a report too large to show, and downloads the file", async ({
    page,
    mockApi,
    feeReportsPage,
    signedIn: _signedIn,
  }) => {
    const state = stubReports(mockApi, {
      permissions: FEES_REPORTS_ACCOUNTANT_PERMISSIONS,
      rowLimit: 1,
      payments: [payment({ method: "cash" }), payment({ method: "card" })],
    });
    await page.route(REPORT_EXPORT_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: { "content-disposition": 'attachment; filename="collection.xlsx"' },
        body: "PK",
      }),
    );

    await feeReportsPage.goto({ path: "/fees/reports?kind=collection&group=method" });

    await expect(feeReportsPage.tooLarge).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    const exportRequest = page.waitForRequest((r) => isApiCall(r, "POST", REPORT_PATH));
    const downloadPromise = page.waitForEvent("download");
    await feeReportsPage.exportButton("XLSX").click();

    expect((await exportRequest).postDataJSON()).toMatchObject({
      kind: "collection",
      group_by: "method",
      format: "xlsx",
    });
    const download = await downloadPromise;
    expect(download.url()).toBe(state.files[0]?.downloadUrl);
    expect(state.exports).toEqual([expect.objectContaining({ format: "xlsx", rows: 2 })]);
  });
});

test.describe("a principal reading the reports", () => {
  test.use({ authUser: principal });

  test("reads a report and is offered no export", async ({
    mockApi,
    feeReportsPage,
    signedIn: _signedIn,
  }) => {
    stubReports(mockApi, {
      permissions: FEES_REPORTS_PRINCIPAL_PERMISSIONS,
      payments: [payment({ amount: "1000.00" })],
    });

    await feeReportsPage.goto();

    await expect(feeReportsPage.row("Collection", "1,000.00")).toBeVisible();
    await expect(feeReportsPage.exportButton("CSV")).toHaveCount(0);
    await expect(feeReportsPage.exportButton("XLSX")).toHaveCount(0);
  });
});
