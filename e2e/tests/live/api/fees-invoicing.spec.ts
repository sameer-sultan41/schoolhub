import { randomUUID } from "node:crypto";
import type { ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import {
  buildLiveAcademicSession,
  buildLiveCampus,
  buildLiveClass,
  buildLiveSection,
} from "@/data/live-factories";
import { accountantSession, refusal, seededHeadId } from "@/lib/live-fees";
import { awaitJobResult, LIVE_JOB_TIMEOUT_MS } from "@/lib/live-jobs";
import { createStudentReadyToEnrol } from "@/lib/live-student";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Fee invoicing (PR B) against the real API, as the seeded `accountant` (so the real role's keys
 * are what is exercised: `fees.invoice.view|create|update`), on a run-unique session, class and
 * student that no other spec or worker shares. It deliberately does not use the portal's seeded
 * structure: generating from it would add invoices to the portal fixture's children. Field
 * validation stays in the Django suite (`apps/api/apps/fees_finance/tests/`); this lane pins what
 * only a real stack shows: the 202 job through a real worker, the re-run that skips what is
 * billed, the cancel refusals the dashboard shows inline, and RLS.
 *
 * Endpoints covered: `POST /fee-structures`, `POST /fee-schedules`, `POST /fee-structures/{id}:activate`,
 * `POST /fee-invoices:generate`, `GET /jobs/{id}`, `GET /fee-invoices`, `GET /fee-invoices/{id}`,
 * `POST /fee-invoices/{id}:cancel`.
 */

interface Identified {
  id: string;
}

interface Invoice {
  id: string;
  invoice_no: string;
  status: string;
  subtotal: string;
  balance_due: string;
  paid_total: string;
  period_label: string | null;
  canceled_reason: string | null;
  lines: unknown[];
}

interface GenerationResult {
  issued: number;
  skipped: number;
}

/** Two polled jobs, a cold accountant login and the scope's dozen writes (L6). */
const SETUP_MARGIN_MS = 60_000;

/** A run-unique session, class, section and one enrolled student: the only scope a structure
 * built here covers, so a run bills exactly that student. */
async function enrolledStudentScope(admin: ApiClient) {
  const campus = (await admin.post("/campuses", buildLiveCampus())).data as Identified;
  const sessionPayload = buildLiveAcademicSession();
  const session = (await admin.post("/academic-sessions", sessionPayload)).data as Identified;
  const schoolClass = (await admin.post("/classes", buildLiveClass())).data as Identified;
  const section = (
    await admin.post("/sections", {
      ...buildLiveSection(),
      class_id: schoolClass.id,
      campus_id: campus.id,
    })
  ).data as Identified;
  const student = await createStudentReadyToEnrol(admin, campus.id);
  // The session's own start date: `assert_date_in_session` refuses one outside its window.
  await admin.post(`/students/${student.id}:enroll`, {
    academic_session_id: session.id,
    class_id: schoolClass.id,
    section_id: section.id,
    enrollment_date: sessionPayload.start_date,
  });
  return {
    sessionId: session.id,
    classId: schoolClass.id,
    studentId: student.id,
    // The first of the month the session starts in: the period a run bills.
    periodStart: `${sessionPayload.start_date.slice(0, 7)}-01`,
  };
}

async function activeStructure(
  accountant: ApiClient,
  scope: { sessionId: string; classId: string },
): Promise<string> {
  const headId = await seededHeadId(accountant);
  const structure = (
    await accountant.post("/fee-structures", {
      name: `E2E Invoicing ${randomUUID().slice(0, 8)}`,
      academic_session: scope.sessionId,
      school_class: scope.classId,
    })
  ).data as Identified;
  await accountant.post("/fee-schedules", {
    fee_structure: structure.id,
    fee_head: headId,
    amount: "1500.00",
    frequency: "monthly",
    due_day: 10,
  });
  await accountant.post(`/fee-structures/${structure.id}:activate`);
  return structure.id;
}

async function generate(
  accountant: ApiClient,
  body: { fee_structure: string; period_start: string },
  idempotencyKey = randomUUID(),
): Promise<string> {
  const accepted = await accountant.post<{ job_id: string }>("/fee-invoices:generate", body, {
    idempotencyKey,
  });
  expect(accepted.status).toBe(202);
  return accepted.data.job_id;
}

test.describe("fee invoicing (live API)", () => {
  test("the accountant generates a structure's invoices, a re-run skips them, then cancels one", async ({
    liveApiClient,
  }) => {
    test.setTimeout(2 * LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const accountant = await accountantSession();
    const scope = await enrolledStudentScope(liveApiClient);
    const structureId = await activeStructure(accountant, scope);
    const body = { fee_structure: structureId, period_start: scope.periodStart };

    // 202 + a job: the key replays the same job on a double submit, and the worker bills the student.
    const key = randomUUID();
    const jobId = await generate(accountant, body, key);
    expect(await generate(accountant, body, key)).toBe(jobId);
    const first = await awaitJobResult<GenerationResult>(accountant, jobId);
    expect(first).toMatchObject({ issued: 1, skipped: 0 });

    const listed = await accountant.get<Invoice[]>("/fee-invoices", {
      query: { student: scope.studentId, fee_structure_id: structureId },
    });
    expect(listed.data).toHaveLength(1);
    const [invoice] = listed.data as [Invoice];
    // The server's own money fields: nothing paid, so the balance is the whole subtotal.
    expect(invoice).toMatchObject({ status: "issued", paid_total: "0.00" });
    expect(Number(invoice.subtotal)).toBeGreaterThan(0);
    expect(invoice.balance_due).toBe(invoice.subtotal);
    expect(invoice.lines.length).toBeGreaterThan(0);

    // The defaulter filter finds it: a balance owing, not canceled.
    const defaulters = await accountant.get<Invoice[]>("/fee-invoices", {
      query: { student: scope.studentId, outstanding: true },
    });
    expect(defaulters.data.map((row) => row.id)).toEqual([invoice.id]);

    // A new key is a new run: the student is already billed for the period, so it is skipped,
    // and that is a success, not an error.
    const rerun = await awaitJobResult<GenerationResult>(
      accountant,
      await generate(accountant, body),
    );
    expect(rerun).toMatchObject({ issued: 0, skipped: 1 });

    // Cancel needs a reason, and an invoice cannot be canceled twice.
    const canceled = await accountant.post<Invoice>(`/fee-invoices/${invoice.id}:cancel`, {
      reason: "E2E cancel",
    });
    expect(canceled.data).toMatchObject({ status: "canceled", canceled_reason: "E2E cancel" });
    const again = await refusal(
      accountant.post(`/fee-invoices/${invoice.id}:cancel`, { reason: "E2E cancel again" }),
    );
    expect(again.status).toBe(422);
    expect(again.details.map((detail) => detail.field)).toContain("status");

    // Canceled invoices leave the defaulter list.
    const after = await accountant.get<Invoice[]>("/fee-invoices", {
      query: { student: scope.studentId, outstanding: true },
    });
    expect(after.data).toHaveLength(0);
  });

  test("generating from a structure that is not active is refused under fee_structure", async ({
    liveApiClient,
  }) => {
    const accountant = await accountantSession();
    const scope = await enrolledStudentScope(liveApiClient);
    const draft = (
      await accountant.post("/fee-structures", {
        name: `E2E Draft Invoicing ${randomUUID().slice(0, 8)}`,
        academic_session: scope.sessionId,
        school_class: scope.classId,
      })
    ).data as Identified;

    const refused = await refusal(
      accountant.post(
        "/fee-invoices:generate",
        { fee_structure: draft.id, period_start: scope.periodStart },
        { idempotencyKey: randomUUID() },
      ),
    );

    expect(refused.status).toBe(422);
    expect(refused.details.map((detail) => detail.field)).toContain("fee_structure");
  });

  test("an invoice of another tenant is a 404, never a 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    test.setTimeout(LIVE_JOB_TIMEOUT_MS + SETUP_MARGIN_MS);
    const accountant = await accountantSession();
    const scope = await enrolledStudentScope(liveApiClient);
    const structureId = await activeStructure(accountant, scope);
    await awaitJobResult<GenerationResult>(
      accountant,
      await generate(accountant, { fee_structure: structureId, period_start: scope.periodStart }),
    );
    const listed = await accountant.get<Invoice[]>("/fee-invoices", {
      query: { student: scope.studentId },
    });
    const [invoice] = listed.data as [Invoice];

    try {
      // A real row and a real second identity: a 403 would confirm the row exists elsewhere.
      // The other tenant has `module.fees_finance` on (seed_e2e_data.py), so the feature gate
      // does not answer first.
      const read = await refusal(liveOtherTenantApiClient.get(`/fee-invoices/${invoice.id}`));
      expect(read.status).toBe(404);
      expect(read.code).toBe("not_found");
      const cancel = await refusal(
        liveOtherTenantApiClient.post(`/fee-invoices/${invoice.id}:cancel`, { reason: "No." }),
      );
      expect(cancel.status).toBe(404);
      const others = await liveOtherTenantApiClient.get<Invoice[]>("/fee-invoices", {
        query: { student: scope.studentId },
      });
      expect(others.data).toHaveLength(0);
    } finally {
      await accountant.post(`/fee-invoices/${invoice.id}:cancel`, { reason: "E2E cleanup" });
    }
  });
});
