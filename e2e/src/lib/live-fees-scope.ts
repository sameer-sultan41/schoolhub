import { randomUUID } from "node:crypto";
import type { ApiClient } from "@schoolhub/api-client";
import { expect } from "@/fixtures";
import {
  buildLiveAcademicSession,
  buildLiveCampus,
  buildLiveClass,
  buildLiveSection,
} from "@/data/live-factories";
import { accountantSession, seededHeadId } from "@/lib/live-fees";
import { awaitJobResult } from "@/lib/live-jobs";
import { createStudentReadyToEnrol } from "@/lib/live-student";

/** What the live fees specs share to bill a student: a run-unique scope, an active structure
 * over it, and a `:generate` call. Shared by invoicing (PR B) and collection (PR C). */

interface Identified {
  id: string;
}

/** A run-unique session, class, section and one enrolled student: the only scope a structure
 * built here covers, so a run bills exactly that student. */
export async function enrolledStudentScope(admin: ApiClient) {
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
    // What the counter's picker is searched by and shows.
    studentName: `${student.first_name} ${student.last_name}`,
    // The first of the month the session starts in: the period a run bills.
    periodStart: `${sessionPayload.start_date.slice(0, 7)}-01`,
  };
}

export async function activeStructure(
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

export async function generate(
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

/** An invoice as the live specs read it: the server's own money columns. */
export interface LiveInvoice {
  id: string;
  invoice_no: string;
  status: string;
  subtotal: string;
  paid_total: string;
  balance_due: string;
}

/** One polled job, two cold logins and the scope's dozen writes (L6). */
export const SETUP_MARGIN_MS = 60_000;

/**
 * A run-unique student billed once: the invoice the counter takes money against. The structure is
 * the seeded accountant's to build; `biller` (the counter's own session) runs the generation and
 * reads the invoice back, so the real role's keys are what is exercised.
 */
export async function billedInvoice(admin: ApiClient, biller: ApiClient) {
  const accountant = await accountantSession();
  const scope = await enrolledStudentScope(admin);
  const structureId = await activeStructure(accountant, scope);
  const jobId = await generate(biller, {
    fee_structure: structureId,
    period_start: scope.periodStart,
  });
  const result = await awaitJobResult<{ issued: number; skipped: number }>(biller, jobId);
  expect(result).toMatchObject({ issued: 1, skipped: 0 });
  const listed = await biller.get<LiveInvoice[]>("/fee-invoices", {
    query: { student: scope.studentId },
  });
  const [invoice] = listed.data as [LiveInvoice];
  return { scope, invoice };
}
