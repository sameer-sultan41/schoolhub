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
 * Grants (PR B2) share the lane: the scholarship lifecycle's server-enforced transition table (an
 * illegal move is a 422 under `status`), `:revoke` and `:waive`, and RLS on all three registers.
 *
 * Endpoints covered: `POST /fee-structures`, `POST /fee-schedules`, `POST /fee-structures/{id}:activate`,
 * `POST /fee-invoices:generate`, `GET /jobs/{id}`, `GET /fee-invoices`, `GET /fee-invoices/{id}`,
 * `POST /fee-invoices/{id}:cancel`, `POST /fee-heads`, `POST /discounts`, `GET /discounts/{id}`,
 * `POST /discounts/{id}:revoke`, `POST /scholarships`, `PATCH /scholarships/{id}`, `POST /fines`,
 * `POST /fines/{id}:waive`.
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

interface GrantRecord {
  id: string;
  status: string;
  student_name: string;
  waived_reason?: string | null;
  notes?: string | null;
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

/** The seeded income account's id, taken from the seeded head: a fine head needs an income account. */
async function seededIncomeAccountId(accountant: ApiClient): Promise<string> {
  const heads = await accountant.get<(Identified & { ledger_account: string })[]>("/fee-heads", {
    query: { ordering: "code" },
  });
  const [head] = heads.data;
  if (!head) throw new Error("no fee head is seeded — run manage.py seed_e2e_fees");
  return head.ledger_account;
}

/** A run-unique fee head in the `fine` category, the only kind a fine accepts. */
async function fineHeadId(accountant: ApiClient): Promise<string> {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const head = (
    await accountant.post("/fee-heads", {
      name: `E2E Fines ${suffix}`,
      code: `FN${suffix}`,
      category: "fine",
      ledger_account: await seededIncomeAccountId(accountant),
    })
  ).data as Identified;
  return head.id;
}

/** One discount, one scholarship (as `applied`) and one fine for the scope's student. */
async function seedGrants(accountant: ApiClient, scope: { sessionId: string; studentId: string }) {
  const tag = randomUUID().slice(0, 8);
  const discount = (
    await accountant.post<GrantRecord>("/discounts", {
      student: scope.studentId,
      academic_session: scope.sessionId,
      name: `E2E discount ${tag}`,
      discount_type: "percent",
      value: "10.00",
    })
  ).data;
  const scholarship = (
    await accountant.post<GrantRecord>("/scholarships", {
      student: scope.studentId,
      academic_session: scope.sessionId,
      name: `E2E scholarship ${tag}`,
      coverage_type: "percent",
      value: "25.00",
      status: "applied",
    })
  ).data;
  const fine = (
    await accountant.post<GrantRecord>("/fines", {
      student: scope.studentId,
      fee_head: await fineHeadId(accountant),
      amount: "250.00",
      reason: `E2E fine ${tag}`,
    })
  ).data;
  return { discount, scholarship, fine };
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

  test("a discount is revoked, a fine waived, and a scholarship follows only its lifecycle", async ({
    liveApiClient,
  }) => {
    test.setTimeout(SETUP_MARGIN_MS);
    const accountant = await accountantSession();
    const scope = await enrolledStudentScope(liveApiClient);
    const { discount, scholarship, fine } = await seedGrants(accountant, scope);
    expect(discount).toMatchObject({ status: "active" });
    // The row names its student, so the register needs no student read to be legible.
    expect(discount.student_name.length).toBeGreaterThan(0);

    // Revoke needs a reason (400 under `reason`) and records the status.
    const noReason = await refusal(accountant.post(`/discounts/${discount.id}:revoke`, {}));
    expect(noReason.details.map((detail) => detail.field)).toContain("reason");
    const revoked = await accountant.post<GrantRecord>(`/discounts/${discount.id}:revoke`, {
      reason: "E2E revoke",
    });
    expect(revoked.data.status).toBe("revoked");

    // Waive: only a pending fine, and only once.
    expect(fine.status).toBe("pending");
    const waived = await accountant.post<GrantRecord>(`/fines/${fine.id}:waive`, {
      reason: "E2E waive",
    });
    expect(waived.data).toMatchObject({ status: "waived", waived_reason: "E2E waive" });
    const again = await refusal(
      accountant.post(`/fines/${fine.id}:waive`, { reason: "E2E waive again" }),
    );
    expect(again.status).toBe(422);
    expect(again.details.map((detail) => detail.field)).toContain("status");

    // applied -> approved is legal; approved -> ended skips a step and is a 422 under `status`.
    const approved = await accountant.patch<GrantRecord>(`/scholarships/${scholarship.id}`, {
      status: "approved",
    });
    expect(approved.data.status).toBe("approved");
    const skipped = await refusal(
      accountant.patch(`/scholarships/${scholarship.id}`, {
        status: "ended",
        notes: "Skipping a step",
      }),
    );
    expect(skipped.status).toBe(422);
    expect(skipped.details.map((detail) => detail.field)).toContain("status");

    // Revoking needs notes; with them it is legal, and then the award is final.
    const unexplained = await refusal(
      accountant.patch(`/scholarships/${scholarship.id}`, { status: "revoked" }),
    );
    expect(unexplained.details.map((detail) => detail.field)).toContain("notes");
    const revokedAward = await accountant.patch<GrantRecord>(`/scholarships/${scholarship.id}`, {
      status: "revoked",
      notes: "E2E revoke",
    });
    expect(revokedAward.data.status).toBe("revoked");
    const reopened = await refusal(
      accountant.patch(`/scholarships/${scholarship.id}`, { status: "active" }),
    );
    expect(reopened.status).toBe(422);
    expect(reopened.details.map((detail) => detail.field)).toContain("status");
    const stillRevoked = await accountant.get<GrantRecord>(`/scholarships/${scholarship.id}`);
    expect(stillRevoked.data.status).toBe("revoked");
  });

  test("another tenant's discount, scholarship and fine are a 404, never a 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    test.setTimeout(SETUP_MARGIN_MS);
    const accountant = await accountantSession();
    const scope = await enrolledStudentScope(liveApiClient);
    const { discount, scholarship, fine } = await seedGrants(accountant, scope);

    for (const [path, id] of [
      ["discounts", discount.id],
      ["scholarships", scholarship.id],
      ["fines", fine.id],
    ] as const) {
      // A real row and a real second identity: a 403 would confirm the row exists elsewhere.
      const read = await refusal(liveOtherTenantApiClient.get(`/${path}/${id}`));
      expect(read.status).toBe(404);
      const others = await liveOtherTenantApiClient.get<GrantRecord[]>(`/${path}`, {
        query: { student: scope.studentId },
      });
      expect(others.data).toHaveLength(0);
    }
    const revoke = await refusal(
      liveOtherTenantApiClient.post(`/discounts/${discount.id}:revoke`, { reason: "No." }),
    );
    expect(revoke.status).toBe(404);
    const waive = await refusal(
      liveOtherTenantApiClient.post(`/fines/${fine.id}:waive`, { reason: "No." }),
    );
    expect(waive.status).toBe(404);
    const move = await refusal(
      liveOtherTenantApiClient.patch(`/scholarships/${scholarship.id}`, { status: "approved" }),
    );
    expect(move.status).toBe(404);
  });
});
