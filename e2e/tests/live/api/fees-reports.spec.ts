import { randomUUID } from "node:crypto";
import type { ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import { accountantSession, financeStaffSession, refusal } from "@/lib/live-fees";
import { billedInvoice, type LiveInvoice, SETUP_MARGIN_MS } from "@/lib/live-fees-scope";
import { awaitJobResult, LIVE_JOB_TIMEOUT_MS } from "@/lib/live-jobs";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * The finance reports (PR E) against the real API. Two run-unique students, on two campuses and
 * two sessions, are billed and each pays a different amount, so a total says exactly which
 * payments a campus or session filter let through. The seeded `accountant` runs the reports
 * (`fees.report.view`, `.export`); the seeded `finance_staff` takes the money. Field validation
 * stays in the Django suite (`apps/api/apps/fees_finance/tests/test_report_filters.py`); this lane
 * pins what only a real stack shows: the typed rows' real field names, the filters narrowing a
 * real query, the export job honouring the same filters, and the statement closing on the
 * server's balance.
 *
 * Endpoints covered: `GET /reports/finance-summary`, `POST /reports/finance-summary`,
 * `GET /students/{id}/ledger`, `GET /jobs/{id}`, `POST /payments:record`.
 */

const SUMMARY = "/reports/finance-summary";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_HERE = "500.00";
const PAID_THERE = "300.00";

/** A window that holds today's payments whichever side of UTC midnight the run is on. */
function todayWindow(): { date_from: string; date_to: string } {
  const now = Date.now();
  return {
    date_from: new Date(now - DAY_MS).toISOString().slice(0, 10),
    date_to: new Date(now + DAY_MS).toISOString().slice(0, 10),
  };
}

async function pay(counter: ApiClient, invoice: LiveInvoice, amount: string) {
  await counter.post(
    "/payments:record",
    { fee_invoice: invoice.id, amount, method: "cash" },
    { idempotencyKey: randomUUID() },
  );
}

async function run<TRow>(accountant: ApiClient, query: Record<string, string>) {
  const response = await accountant.get<TRow[]>(SUMMARY, { query: { ...todayWindow(), ...query } });
  return response.data;
}

interface CollectionRow {
  kind: string;
  day: string | null;
  method: string | null;
  received_by: string | null;
  total: string;
  count: number;
}

/** Two students on two campuses and two sessions, each having paid their own amount. */
async function twoPaidStudents(admin: ApiClient) {
  const counter = await financeStaffSession();
  const here = await billedInvoice(admin, counter);
  const there = await billedInvoice(admin, counter);
  await pay(counter, here.invoice, PAID_HERE);
  await pay(counter, there.invoice, PAID_THERE);
  return { here: here.scope, there: there.scope };
}

test.describe("finance reports (live API)", () => {
  test("a campus or session filter narrows the collection to that scope's payments", async ({
    liveApiClient,
  }) => {
    test.setTimeout(2 * (LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS));
    const accountant = await accountantSession();
    const { here, there } = await twoPaidStudents(liveApiClient);

    const hereRows = await run<CollectionRow>(accountant, {
      kind: "collection",
      academic_session_id: here.sessionId,
    });
    // The payment is in the report, as one day's row with the server's own sum.
    expect(hereRows).toEqual([
      expect.objectContaining({ kind: "collection", total: PAID_HERE, count: 1, method: null }),
    ]);
    const thereRows = await run<CollectionRow>(accountant, {
      kind: "collection",
      academic_session_id: there.sessionId,
    });
    expect(thereRows.map((row) => row.total)).toEqual([PAID_THERE]);

    // A campus filter excludes the other campus's row: its own campus keeps the payment, the
    // other campus's keeps none of it.
    const sameCampus = await run<CollectionRow>(accountant, {
      kind: "collection",
      academic_session_id: here.sessionId,
      campus_id: here.campusId,
    });
    expect(sameCampus.map((row) => row.total)).toEqual([PAID_HERE]);
    const otherCampus = await run<CollectionRow>(accountant, {
      kind: "collection",
      academic_session_id: here.sessionId,
      campus_id: there.campusId,
    });
    expect(otherCampus).toEqual([]);

    // The class the invoice was billed to narrows it the same way.
    const otherClass = await run<CollectionRow>(accountant, {
      kind: "collection",
      academic_session_id: here.sessionId,
      class_id: there.classId,
    });
    expect(otherClass).toEqual([]);

    // Grouped by method, the row names the method and carries the other two keys as null.
    const byMethod = await run<CollectionRow>(accountant, {
      kind: "collection",
      academic_session_id: here.sessionId,
      group_by: "method",
    });
    expect(byMethod).toEqual([
      expect.objectContaining({ method: "cash", day: null, received_by: null, total: PAID_HERE }),
    ]);
  });

  test("the typed rows carry exactly the fields the client reads, and a foreign id filters to nothing", async ({
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const accountant = await accountantSession();
    const counter = await financeStaffSession();
    const { scope, invoice } = await billedInvoice(liveApiClient, counter);
    await pay(counter, invoice, PAID_HERE);

    const [aging] = await run<Record<string, unknown>>(accountant, {
      kind: "outstanding-aging",
      academic_session_id: scope.sessionId,
    });
    expect(Object.keys(aging ?? {}).sort()).toEqual(
      [
        "kind",
        "student_id",
        "admission_number",
        "first_name",
        "last_name",
        "total_outstanding",
        "invoice_count",
        "not_yet_due",
        "bucket_0_30",
        "bucket_31_60",
        "bucket_61_90",
        "bucket_90_plus",
      ].sort(),
    );
    expect(aging).toMatchObject({
      kind: "outstanding-aging",
      student_id: scope.studentId,
      // 1,500 billed, 500 paid: the server's own balance, never summed client-side.
      total_outstanding: "1000.00",
      invoice_count: 1,
    });

    // The ledger reports carry the account's type (the server reads it off the join).
    const income = await run<Record<string, unknown>>(accountant, { kind: "income-vs-expense" });
    expect(income.length).toBeGreaterThan(0);
    for (const row of income) expect(["income", "expense"]).toContain(row["account_type"]);

    const statement = await run<Record<string, unknown>>(accountant, {
      kind: "student-ledger",
      student: scope.studentId,
    });
    expect(statement.map((row) => [row["entry_type"], row["kind"]])).toEqual([
      ["invoice", "student-ledger"],
      ["payment", "student-ledger"],
    ]);

    // An id no tenant row has (another tenant's would be the same) is an empty report.
    for (const filter of ["campus_id", "academic_session_id", "class_id"]) {
      expect(await run(accountant, { kind: "outstanding-aging", [filter]: randomUUID() })).toEqual(
        [],
      );
    }

    // A filter on a kind with no such dimension is refused under that field.
    const refused = await refusal(
      accountant.get(SUMMARY, {
        query: { ...todayWindow(), kind: "trial-balance", campus_id: scope.campusId },
      }),
    );
    expect(refused.status).toBe(400);
    expect(refused.details.map((detail) => detail.field)).toContain("campus_id");
  });

  test("the statement endpoint closes on the server's balance, in its typed lines", async ({
    liveApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const accountant = await accountantSession();
    const counter = await financeStaffSession();
    const { scope, invoice } = await billedInvoice(liveApiClient, counter);
    await pay(counter, invoice, PAID_HERE);

    const statement = await accountant.get<Record<string, unknown>[]>(
      `/students/${scope.studentId}/ledger`,
    );

    expect(statement.data.map((line) => line["kind"])).toEqual(["invoice", "payment"]);
    expect(Object.keys(statement.data[0] ?? {}).sort()).toEqual(
      ["date", "kind", "reference", "description", "debit", "credit", "balance"].sort(),
    );
    expect(statement.meta).toMatchObject({ row_count: 2, closing_balance: "1000.00" });
    // The payment just taken is on the statement, as a credit of the amount paid.
    expect(statement.data[1]).toMatchObject({ kind: "payment", credit: PAID_HERE, debit: "0.00" });
  });

  test("another tenant's student statement is a 404, never a 403 or an empty one", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const counter = await financeStaffSession();
    const { scope, invoice } = await billedInvoice(liveApiClient, counter);
    await pay(counter, invoice, PAID_HERE);

    // A real student with a real statement and a real second identity: a 403 or an empty 200
    // would confirm the student exists elsewhere.
    const refused = await refusal(
      liveOtherTenantApiClient.get(`/students/${scope.studentId}/ledger`),
    );

    expect(refused.status).toBe(404);
  });

  test("an export is a job that completes with a file, and carries the filters", async ({
    liveApiClient,
  }) => {
    test.setTimeout(2 * (LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS));
    const accountant = await accountantSession();
    const { here } = await twoPaidStudents(liveApiClient);

    const accepted = await accountant.post<{ job_id: string }>(SUMMARY, {
      ...todayWindow(),
      kind: "collection",
      group_by: "method",
      academic_session_id: here.sessionId,
      format: "csv",
    });
    expect(accepted.status).toBe(202);
    const result = await awaitJobResult<{ result_file_id: string; rows: number; format: string }>(
      accountant,
      accepted.data.job_id,
    );

    // One method row for the one session: the job filtered as the inline report does.
    expect(result).toMatchObject({ rows: 1, format: "csv" });
    expect(result.result_file_id).toEqual(expect.any(String));
  });
});
