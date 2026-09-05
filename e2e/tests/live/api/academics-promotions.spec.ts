import { ApiError } from "@schoolhub/api-client";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { seedPromotionBatch } from "@/lib/live-promotion-batch";
import { E2E_PRINCIPAL_EMAIL } from "@/lib/seed-constants";

interface PromotionRow {
  id: string;
  batch_id: string;
  student_id: string;
  status: string;
  decision: string;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
}

/** One entry of `GET /students/{id}/history` — see `services.build_history`. */
interface HistoryEvent {
  type: string;
  id: string;
  status: string;
  academic_session_id?: string;
}

interface ExecutionReport {
  enrolled: { student_id: string }[];
  graduated: { student_id: string }[];
  skipped: { student_id: string; reason: string }[];
  failed: { student_id: string; error: string }[];
}

/**
 * Live API lane — no browser, no UI.
 *
 * The §7.2 state machine end to end: `draft → pending_approval → approved → executed`,
 * with the two rules the workflow exists for. Both are only provable against a real
 * server: **segregation of duties** compares the acting user against the rows' own
 * `created_by`, so it needs two real identities and real rows; **idempotent execution**
 * is a per-row `executed` skip inside a service that also writes real enrollments
 * through student-management, so "a re-run creates no second enrollment" is a claim
 * about the database, not about a response body.
 *
 * One test, not four: `seedPromotionBatch` is a dozen real writes (a session pair, a
 * class pair, sections, a student with a guardian and an emergency contact, an
 * enrollment), and the lifecycle is a single ordered journey — splitting it would repeat
 * that setup per state transition and prove nothing extra. The approver logs in once
 * here; `AuthEndpointThrottle` allows 10 requests/minute per IP across
 * login/refresh/logout, so this file deliberately costs exactly one extra login
 * (see e2e/AGENTS.md's auth-throttle section).
 */
test.describe("student promotions (live API)", () => {
  test("prepares, approves with a second identity, and executes a batch idempotently", async ({
    liveApiClient,
  }) => {
    const batch = await seedPromotionBatch(liveApiClient);

    const submitted = await liveApiClient.post(`/student-promotions/${batch.batchId}:submit`);
    expect(submitted.status).toBe(200);
    expect(submitted.data).toEqual({ updated: 1 });
    expect(submitted.meta?.message).toBe("Batch submitted for approval.");

    const pending = await liveApiClient.get<PromotionRow[]>("/student-promotions", {
      query: { batch_id: batch.batchId },
    });
    expect(pending.data[0]?.status).toBe("pending_approval");

    // The preparer is this worker's own session — it created the batch, so its rows'
    // `created_by` is this user. `academics.promotion.approve` is held (the seeded admin
    // is a `school_owner`, which holds every key), so this is refused by the *rule*, not
    // by the permission gate: a 422 domain-rule violation, not a 403.
    const selfApproval = await liveApiClient
      .post(`/student-promotions/${batch.batchId}:approve`)
      .catch((error: unknown) => error);
    expect(selfApproval).toBeInstanceOf(ApiError);
    expect((selfApproval as ApiError).status).toBe(422);
    expect((selfApproval as ApiError).code).toBe("domain_rule_violation");
    // Pinned by message as well as status: several other rules answer 422 on this same
    // endpoint (a batch in the wrong state, an incomplete decision), and only this one is
    // the segregation-of-duties refusal.
    expect((selfApproval as ApiError).message.toLowerCase()).toContain("cannot approve it");

    const stillPending = await liveApiClient.get<PromotionRow[]>("/student-promotions", {
      query: { batch_id: batch.batchId },
    });
    expect(stillPending.data[0]?.status).toBe("pending_approval");

    // A real second identity: the seeded `principal`, who holds
    // `academics.promotion.approve` and deliberately not `.execute` (§4).
    const approverClient = await createLiveSession({
      identifier: E2E_PRINCIPAL_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    const approved = await approverClient.post(`/student-promotions/${batch.batchId}:approve`);
    expect(approved.status).toBe(200);
    expect(approved.data).toEqual({ updated: 1 });

    const afterApproval = await liveApiClient.get<PromotionRow[]>("/student-promotions", {
      query: { batch_id: batch.batchId },
    });
    const approvedRow = afterApproval.data[0];
    if (!approvedRow) throw new Error("expected the batch's single row to still exist");
    expect(approvedRow.status).toBe("approved");
    expect(approvedRow.approved_by).not.toBeNull();
    expect(approvedRow.approved_at).not.toBeNull();

    // Execution is `school_admin`'s step (§4); the worker admin holds every key, so it
    // stands in for one here — the *approval* is the step that needed a distinct person.
    const executed = await liveApiClient.post(`/student-promotions/${batch.batchId}:execute`);
    expect(executed.status).toBe(200);
    const report = executed.data as ExecutionReport;
    expect(report.enrolled.map((entry) => entry.student_id)).toEqual([batch.studentId]);
    expect(report.failed).toEqual([]);

    // The point of the whole workflow, and the half no response body can assert on its
    // own: student-management really ended the old enrollment and created a new one.
    // `GET /students/{id}/history` is the only read that exposes enrollments (there is no
    // `/enrollments` collection endpoint — `build_history` is the timeline the module doc
    // §10 defines).
    const history = await liveApiClient.get<HistoryEvent[]>(`/students/${batch.studentId}/history`);
    const enrollments = history.data.filter((event) => event.type === "enrollment");
    expect(enrollments).toHaveLength(2);
    expect(
      enrollments.find((event) => event.academic_session_id === batch.toSessionId)?.status,
    ).toBe("active");
    expect(
      enrollments.find((event) => event.academic_session_id === batch.fromSessionId)?.status,
    ).toBe("promoted");

    // §11: "re-execution attempts are no-ops". A *different* Idempotency-Key on purpose —
    // the 24h replay cache would return the first response verbatim and prove nothing, so
    // this exercises the service's own per-row `executed` skip, which is what keeps a
    // re-run safe long after the replay window has closed.
    const reExecuted = await liveApiClient.post(
      `/student-promotions/${batch.batchId}:execute`,
      undefined,
      { idempotencyKey: `e2e-re-execute-${batch.batchId}` },
    );
    const secondReport = reExecuted.data as ExecutionReport;
    expect(secondReport.enrolled).toEqual([]);
    expect(secondReport.skipped[0]?.reason).toBe("already executed");

    const afterReExecution = await liveApiClient.get<HistoryEvent[]>(
      `/students/${batch.studentId}/history`,
    );
    expect(afterReExecution.data.filter((event) => event.type === "enrollment")).toHaveLength(2);
  });
});
