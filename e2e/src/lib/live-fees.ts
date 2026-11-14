import type { ApiClient } from "@schoolhub/api-client";
import { buildLiveFeeHead, buildLiveFeeStructure } from "@/data/live-factories";
import { awaitJobResult } from "@/lib/live-jobs";
import { createStudentReadyToEnrol } from "@/lib/live-student";
import { seedTimetableScaffold } from "@/lib/live-timetable-grid";

/**
 * A run-unique student with one issued invoice, built through the real fees API.
 *
 * Everything is run-unique (campus, class, section and a far-future session from
 * `seedTimetableScaffold`), so generating invoices for the structure's class bills only this
 * spec's student, and a rerun never finds yesterday's invoice already paid. The fee head posts
 * to the seeded system account 4000 (`seed_e2e_data` runs `seed_finance_accounts`).
 */

interface Identified {
  id: string;
}

export interface IssuedInvoice {
  studentId: string;
  invoiceId: string;
  amount: string;
}

const FEE_INCOME_ACCOUNT_CODE = "4000";
const MONTHLY_FEE = "1500.00";
const DUE_DAY = 10;

/**
 * A billing month that starts on the 1st. The generator clamps the window to the session, so a
 * session starting after `DUE_DAY` would issue on day N and fall due on day `DUE_DAY` < N, which
 * the `fee_invoices_due_after_issue` CHECK refuses. The next month's 1st is always inside the
 * 365-day session and never clamped.
 */
function firstOfNextMonth(isoDate: string): string {
  const start = new Date(`${isoDate}T00:00:00Z`);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

async function feeIncomeAccountId(client: ApiClient): Promise<string> {
  const listed = await client.get<{ id: string; code: string }[]>("/ledger-accounts", {
    query: { account_type: "income", is_system: "true" },
  });
  const income = listed.data.find((row) => row.code === FEE_INCOME_ACCOUNT_CODE);
  if (!income) {
    throw new Error("the seeded fee income account is missing — run manage.py seed_e2e_data");
  }
  return income.id;
}

export async function seedIssuedInvoice(client: ApiClient): Promise<IssuedInvoice> {
  const scaffold = await seedTimetableScaffold(client);
  const student = await createStudentReadyToEnrol(client, scaffold.campusId);
  await client.post(`/students/${student.id}:enroll`, {
    academic_session_id: scaffold.sessionId,
    class_id: scaffold.classId,
    section_id: scaffold.sectionId,
    enrollment_date: scaffold.sessionStartDate,
  });

  const head = (await client.post("/fee-heads", buildLiveFeeHead(await feeIncomeAccountId(client))))
    .data as Identified;
  const structure = (
    await client.post(
      "/fee-structures",
      buildLiveFeeStructure(scaffold.sessionId, scaffold.classId),
    )
  ).data as Identified;
  await client.post("/fee-schedules", {
    fee_structure: structure.id,
    fee_head: head.id,
    amount: MONTHLY_FEE,
    frequency: "monthly",
    due_day: DUE_DAY,
  });
  await client.post(`/fee-structures/${structure.id}:activate`, {});

  const accepted = await client.post(
    "/fee-invoices:generate",
    { fee_structure: structure.id, period_start: firstOfNextMonth(scaffold.sessionStartDate) },
    { idempotencyKey: crypto.randomUUID() },
  );
  await awaitJobResult(client, (accepted.data as { job_id: string }).job_id);

  const invoices = await client.get<{ id: string; total_amount?: string }[]>("/fee-invoices", {
    query: { student: student.id },
  });
  const [invoice] = invoices.data;
  if (!invoice || invoices.data.length !== 1) {
    throw new Error(`expected one generated invoice, found ${invoices.data.length}`);
  }
  return { studentId: student.id, invoiceId: invoice.id, amount: MONTHLY_FEE };
}

/**
 * The header the fake provider signs a callback with, exactly as `FakeAdapter.verify_callback`
 * checks it: `X-Fake-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`
 * (apps/api/core/integrations/payments/fake.py).
 */
export const FAKE_SIGNATURE_HEADER = "X-Fake-Signature";

export async function signFakeCallback(
  secret: string,
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `t=${timestamp},v1=${hex}`;
}
