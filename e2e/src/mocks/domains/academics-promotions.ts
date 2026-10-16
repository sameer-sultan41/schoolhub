import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, ok } from "../envelope";
import { compareValues, lockedSessionResponse, nameOf, pageOf, type Named } from "../list";
import type { MockModule } from "../router";
import type { JobStub } from "./jobs";
import type { AcademicSession, Section } from "./school-organization";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type PromotionStatus = ApiSchemas["PromotionStatusEnum"];
export type PromotionDecisionValue = ApiSchemas["PromotionDecisionEnum"];

/** The generated `PromotionDecision`, writable here because this stub plays the server. */
export type PromotionDecision = Mutable<ApiSchemas["PromotionDecision"]>;

/** What `GET /student-promotions/{id}` serves; the list serves the same row without `decisions`. */
export interface PromotionBatch extends Omit<ApiSchemas["PromotionBatchDetail"], "decisions"> {
  decisions: PromotionDecision[];
}

/** A finished `promotion.execute` job's `result`: a type alias, so a valid `JobStub` result. */
export type PromotionExecutionReport = {
  enrolled: { student_id: string }[];
  graduated: { student_id: string }[];
  skipped: { student_id: string; reason: string }[];
  failed: { student_id: string; error: string }[];
};

/** A student actively enrolled in a class: who a created batch proposes a decision for. */
export interface PromotionStudent {
  id: string;
  name: string;
  admission_number: string;
}

/** `decision_basis` as `create_promotion_batch` records it: the proposal the §11 override rule
 * compares the row against at submit. `toClassId` is `null` for a graduating proposal. */
export function proposalBasis(decision: PromotionDecisionValue, toClassId: string | null) {
  return {
    rule: "level+1",
    results_available: false,
    attendance_available: false,
    proposed_decision: decision,
    proposed_to_class_id: toClassId,
  };
}

/**
 * One student's row. Unless `decision_basis` is given, the row is "as proposed": its own
 * decision and target class are what the basis records, so it needs no override reason.
 */
export function buildPromotionDecision(
  overrides: Partial<PromotionDecision> = {},
): PromotionDecision {
  const row: PromotionDecision = {
    id: uuid(),
    batch_id: "",
    student_id: uuid(),
    student_name: "Hamza Khan",
    admission_number: "ADM-0001",
    from_enrollment_id: uuid(),
    from_academic_session_id: "",
    to_academic_session_id: "",
    from_class_id: "",
    from_class_name: "",
    to_class_id: null,
    to_class_name: null,
    to_section_id: null,
    to_section_name: null,
    decision: "promoted",
    decision_basis: null,
    override_reason: null,
    remarks: null,
    status: "draft",
    approved_by: null,
    approved_at: null,
    executed_at: null,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-01T08:00:00Z",
    ...overrides,
  };
  row.decision_basis ??= proposalBasis(row.decision, row.to_class_id ?? null);
  return row;
}

type BatchFields = Omit<ApiSchemas["PromotionBatchDetail"], "decisions" | "students">;

export type PromotionBatchOverrides = Partial<BatchFields> & {
  /** One partial row per student; the batch's ids, names and status fill in the rest. */
  decisions?: Partial<PromotionDecision>[];
};

/** A batch in `status` (a draft by default) with one row per entry of `decisions`. A UUID
 * `batch_id`: the review page treats any other segment as not found. */
export function buildPromotionBatch(overrides: PromotionBatchOverrides = {}): PromotionBatch {
  const { decisions = [], ...fields } = overrides;
  const batch = {
    batch_id: uuid(),
    from_academic_session_id: uuid(),
    from_academic_session_name: "2026-27",
    to_academic_session_id: uuid(),
    to_academic_session_name: "2027-28",
    from_class_id: uuid(),
    from_class_name: "Grade 1",
    status: "draft" as PromotionStatus,
    started_at: "2026-09-01T08:00:00Z",
    ...fields,
  };
  return {
    ...batch,
    students: decisions.length,
    decisions: decisions.map((row) =>
      buildPromotionDecision({
        batch_id: batch.batch_id,
        from_academic_session_id: batch.from_academic_session_id,
        to_academic_session_id: batch.to_academic_session_id,
        from_class_id: batch.from_class_id,
        from_class_name: batch.from_class_name,
        status: batch.status,
        ...row,
      }),
    ),
  };
}

/** The job id `:execute` answers with: give `jobsModule` the poll sequence for it. */
export const PROMOTION_EXECUTE_JOB_ID = "promotion-execute-job";

/** `jobsModule`'s `jobs` for the execute job: running at 40%, then succeeded with `report`. The
 * first poll is immediate and the second two seconds on, so a spec can see a run in progress. */
export function promotionExecuteJob(report: PromotionExecutionReport): Record<string, JobStub[]> {
  return {
    [PROMOTION_EXECUTE_JOB_ID]: [
      { status: "running", progress: 40 },
      { status: "succeeded", progress: 100, result: report },
    ],
  };
}

export interface AcademicsPromotionsOptions {
  batches?: PromotionBatch[];
  /** The students actively enrolled in each class (by class id): who a created batch covers.
   * A class with none is refused, as the API refuses one. */
  students?: Record<string, PromotionStudent[]>;
  /** The lists `schoolOrganizationModule` serves, for the names on created batches and edited
   * rows; `classes` is in ladder order: a created batch proposes the next, the last graduates. */
  sessions?: AcademicSession[];
  classes?: Named[];
  sections?: Section[];
  /** The viewer prepared every batch, so `:approve` answers the segregation-of-duties 422. A
   * spec for an approver who is someone else leaves it off. */
  approverIsPreparer?: boolean;
}

interface CreateBody {
  from_academic_session_id: string;
  to_academic_session_id: string;
  class_id: string;
}

/** The keys a PATCH may change; the rest of a row is the server's. */
const EDITABLE_KEYS = [
  "decision",
  "to_class_id",
  "to_section_id",
  "override_reason",
  "remarks",
] as const;

type DecisionPatch = Partial<Pick<PromotionDecision, (typeof EDITABLE_KEYS)[number]>>;

interface Step {
  from: PromotionStatus;
  to: PromotionStatus;
}

/** Each transition's status before and after, as `services.py` has them. `revert` is not here:
 * it is reachable from every state but `reverted`. */
const TRANSITIONS: Record<"submit" | "approve" | "reject", Step> = {
  submit: { from: "draft", to: "pending_approval" },
  approve: { from: "pending_approval", to: "approved" },
  reject: { from: "pending_approval", to: "draft" },
};

/** When an approval or an execution happened, for the rows' trail. */
const TRAIL_AT = "2026-09-02T09:00:00Z";

/**
 * `/student-promotions`: list, create, detail, the decision PATCH and the colon-actions
 * (`:execute` answers `202` with a job: give `jobsModule` `promotionExecuteJob(report)`).
 * Stateful, `409` for the wrong status; models submit's §11 override-reason refusal and
 * `:approve`'s segregation-of-duties refusal (`approverIsPreparer`). `:execute` flips the batch
 * to `executed` at queue time though the real one changes when the worker finishes: the screen
 * only reloads it when the job ends, so it cannot tell. Sessions, classes and sections stay in
 * `schoolOrganizationModule`; a spec passes the same lists to both.
 */
export function academicsPromotionsModule(options: AcademicsPromotionsOptions = {}): MockModule {
  return (api) => {
    const batches = [...(options.batches ?? [])];
    const students = options.students ?? {};
    const sessions = options.sessions ?? [];
    const classes = options.classes ?? [];
    const sections = options.sections ?? [];

    api.get("/student-promotions", (request) => {
      const rows = filterAndOrder(batches, request.searchParams).map(toListRow);
      return pageOf(rows, request.searchParams);
    });

    api.get("/student-promotions/:batchId", (request) => {
      const match = batches.find((batch) => batch.batch_id === request.params["batchId"]);
      return match ? ok(match) : fail(404, "No such promotion batch.");
    });

    api.post("/student-promotions", (request) => {
      const body = request.json() as CreateBody | null;
      if (!body) return fail(400, "Validation failed.");
      if (body.from_academic_session_id === body.to_academic_session_id) {
        return refusal("to_academic_session_id", "The target session must differ from the source.");
      }
      const locked = lockedSessionResponse(sessions, body.to_academic_session_id);
      if (locked) return locked;

      const enrolled = students[body.class_id] ?? [];
      if (enrolled.length === 0) {
        return refusal("class_id", "No actively enrolled students in this class for that session.");
      }
      const exists = batches.some(
        (batch) =>
          batch.from_academic_session_id === body.from_academic_session_id &&
          batch.to_academic_session_id === body.to_academic_session_id &&
          batch.from_class_id === body.class_id &&
          batch.status !== "reverted",
      );
      if (exists) {
        return fail(409, "A promotion batch already exists for this class and session pair.");
      }

      const fromSession = sessions.find((session) => session.id === body.from_academic_session_id);
      const toSession = sessions.find((session) => session.id === body.to_academic_session_id);
      const ladderIndex = classes.findIndex((candidate) => candidate.id === body.class_id);
      const target = ladderIndex === -1 ? undefined : classes[ladderIndex + 1];
      const created = buildPromotionBatch({
        from_academic_session_id: body.from_academic_session_id,
        from_academic_session_name: fromSession?.name ?? "",
        to_academic_session_id: body.to_academic_session_id,
        to_academic_session_name: toSession?.name ?? "",
        from_class_id: body.class_id,
        from_class_name: nameOf(classes, body.class_id) ?? "",
        started_at: "2026-09-02T08:00:00Z",
        decisions: enrolled.map((student) => ({
          student_id: student.id,
          student_name: student.name,
          admission_number: student.admission_number,
          decision: target ? "promoted" : "graduated",
          to_class_id: target?.id ?? null,
          to_class_name: target?.name ?? null,
        })),
      });
      batches.push(created);
      return ok({ batch_id: created.batch_id, students: created.students }, { status: 201 });
    });

    api.patch("/student-promotions/:batchId/decisions/:studentId", (request) => {
      const batch = batches.find((candidate) => candidate.batch_id === request.params["batchId"]);
      const row = batch?.decisions.find(
        (decision) => decision.student_id === request.params["studentId"],
      );
      if (!batch || !row) return fail(404, "Not found.");
      if (batch.status !== "draft") {
        return fail(409, `This batch is ${batch.status}; only a draft batch can be edited.`);
      }

      const body = (request.json() as DecisionPatch | null) ?? {};
      for (const key of EDITABLE_KEYS) {
        if (key in body) Object.assign(row, { [key]: body[key] });
      }
      const section = sections.find((candidate) => candidate.id === row.to_section_id);
      row.to_class_name = nameOf(classes, row.to_class_id);
      row.to_section_name = section?.name ?? null;
      row.updated_at = TRAIL_AT;
      return ok(row);
    });

    api.post("/student-promotions/:batchAction", (request) => {
      const [batchId, action] = (request.params["batchAction"] ?? "").split(":");
      const batch = batches.find((candidate) => candidate.batch_id === batchId);
      if (!batch) return fail(404, "No such promotion batch.");

      if (action === "execute") {
        if (batch.status !== "approved") {
          return fail(409, "Only an approved batch can be executed.");
        }
        moveTo(batch, "executed");
        return ok({ job_id: PROMOTION_EXECUTE_JOB_ID, status: "queued" as const }, { status: 202 });
      }

      if (action === "revert") {
        if (batch.status === "reverted") return fail(409, "This batch is already reverted.");
        moveTo(batch, "reverted");
        return ok({ updated: batch.decisions.length });
      }

      if (action !== "submit" && action !== "approve" && action !== "reject") {
        return fail(404, "Not found.");
      }
      const { from, to } = TRANSITIONS[action];
      if (batch.status !== from) {
        return fail(409, `This batch is ${batch.status}; the action requires ${from}.`);
      }
      if (action === "submit") {
        const missing = batch.decisions.filter(lacksRequiredReason).length;
        if (missing > 0) {
          return refusal(
            "override_reason",
            "An override reason is required where the decision or the target class differs " +
              `from the proposal. Missing for ${missing} student(s).`,
          );
        }
      }
      if (action === "approve" && options.approverIsPreparer) {
        return refusal(
          "non_field",
          "You prepared this batch, so you cannot approve it. Segregation of duties requires a " +
            "different approver.",
        );
      }
      moveTo(batch, to);
      return ok({ updated: batch.decisions.length });
    });
  };
}

/** 422 as the service's `DomainRuleViolation` sends it: one issue under one field. */
function refusal(field: string, issue: string) {
  return fail(422, issue, { code: "domain_rule_violation", details: [{ field, issue }] });
}

/** Every row of a batch moves together, and the approval and execution trail follows. */
function moveTo(batch: PromotionBatch, status: PromotionStatus): void {
  batch.status = status;
  for (const row of batch.decisions) {
    row.status = status;
    if (status === "approved") {
      row.approved_by = uuid();
      row.approved_at = TRAIL_AT;
    }
    if (status === "executed") row.executed_at = TRAIL_AT;
  }
}

/** Whether a row differs from the proposal recorded at creation (a row with none: not modelled). */
function deviatesFromProposal(row: PromotionDecision): boolean {
  const basis = row.decision_basis as Record<string, unknown> | null;
  if (!basis || !("proposed_to_class_id" in basis)) return false;
  return (
    row.decision !== basis["proposed_decision"] ||
    (row.to_class_id ?? null) !== basis["proposed_to_class_id"]
  );
}

/** A row the §11 rule would stop a submit on: it deviates, and gives no reason. */
function lacksRequiredReason(row: PromotionDecision): boolean {
  return !row.override_reason && deviatesFromProposal(row);
}

/** The list's row: the batch without its decisions. */
function toListRow(batch: PromotionBatch): Omit<PromotionBatch, "decisions"> {
  const { decisions: _decisions, ...summary } = batch;
  return summary;
}

/** The column behind an `?ordering=` field, which is one of the row's own. */
function sortValue(batch: PromotionBatch, field: string): unknown {
  const columns: Record<string, unknown> = { ...batch };
  return columns[field];
}

/** The server's filters and ordering, newest batch first with none given. */
function filterAndOrder(batches: PromotionBatch[], params: URLSearchParams): PromotionBatch[] {
  const status = params.get("status");
  const sessionId = params.get("from_academic_session_id");
  const classId = params.get("from_class_id");
  const ordering = params.get("ordering") ?? "-started_at";

  const matching = batches.filter(
    (batch) =>
      (!status || batch.status === status) &&
      (!sessionId || batch.from_academic_session_id === sessionId) &&
      (!classId || batch.from_class_id === classId),
  );
  const direction = ordering.startsWith("-") ? -1 : 1;
  const field = ordering.replace(/^-/, "");
  const compare = (a: PromotionBatch, b: PromotionBatch) =>
    direction * compareValues(sortValue(a, field), sortValue(b, field));
  return [...matching].sort(compare);
}
