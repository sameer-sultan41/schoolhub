import { copyMappedFields } from "@/lib/helpers";
import {
  PROMOTION_DECISION,
  PROMOTION_DECISION_BODY_FIELDS,
  PROMOTION_DECISIONS,
  PROMOTION_QUERY_FIELDS,
  PROMOTION_UNPROPOSED_DECISIONS,
} from "./promotions-constant";
import type { PromotionBatchFormValues, PromotionDecisionFormValues } from "./promotions.schema";
import type {
  CreatePromotionBatchInput,
  PromotionBatchesQuery,
  PromotionBatchRecord,
  PromotionDecisionRecord,
  PromotionDecisionValue,
  PromotionExecutionReport,
  PromotionProposal,
  UpdateDecisionInput,
} from "./promotions-type";

/**
 * The promotions module's pure helper functions — plain data in, plain data out; no React, no
 * API calls.
 */

/**
 * `PromotionBatchesQuery` -> the list endpoint's query params. Unset and empty-string filters
 * are omitted ("no filter"), so a cleared URL filter never reaches the API.
 */
export function toPromotionQueryParams(
  query: PromotionBatchesQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    PROMOTION_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | undefined>;
}

/** A row's id in the batch list, which groups by status: a partly executed batch is two rows. */
export function promotionBatchRowId(batch: PromotionBatchRecord): string {
  return `${batch.batch_id}:${batch.status}`;
}

/** The create-batch form's values -> the service's input (which owns the snake_case wire body). */
export function toCreateBatchInput(values: PromotionBatchFormValues): CreatePromotionBatchInput {
  return {
    fromAcademicSessionId: values.from_academic_session_id,
    toAcademicSessionId: values.to_academic_session_id,
    classId: values.class_id,
  };
}

/**
 * `UpdateDecisionInput` -> the snake_case PATCH body: only the keys present. Gated on
 * `!== undefined`, not truthiness: a null target class, section or reason is a real value that
 * clears the stored one.
 */
export function toDecisionBody(input: UpdateDecisionInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, PROMOTION_DECISION_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

type ReportEntry<K extends keyof PromotionExecutionReport> = PromotionExecutionReport[K][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStudentEntry(entry: unknown): entry is ReportEntry<"enrolled"> {
  return isRecord(entry) && typeof entry.student_id === "string";
}

function isSkippedEntry(entry: unknown): entry is ReportEntry<"skipped"> {
  return isStudentEntry(entry) && "reason" in entry && typeof entry.reason === "string";
}

function isFailedEntry(entry: unknown): entry is ReportEntry<"failed"> {
  return isStudentEntry(entry) && "error" in entry && typeof entry.error === "string";
}

function isListOf<T>(value: unknown, isEntry: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.every(isEntry);
}

/**
 * A finished `promotion.execute` job's `result` as its report, or `null` when there is none: a
 * failed job has no result, and one that does not have the four lists of well-formed entries is
 * not a report, so the caller never reads a field of a shape it was not given.
 */
export function toPromotionExecutionReport(
  result: Record<string, unknown> | null,
): PromotionExecutionReport | null {
  if (result === null) return null;
  const { enrolled, graduated, skipped, failed } = result;
  if (
    isListOf(enrolled, isStudentEntry) &&
    isListOf(graduated, isStudentEntry) &&
    isListOf(skipped, isSkippedEntry) &&
    isListOf(failed, isFailedEntry)
  ) {
    return { enrolled, graduated, skipped, failed };
  }
  return null;
}

/** A decision row as the editor opens it: ids and text as `""` for "none". */
export function decisionToFormValues(row: PromotionDecisionRecord): PromotionDecisionFormValues {
  return {
    decision: row.decision,
    to_class_id: row.to_class_id ?? "",
    to_section_id: row.to_section_id ?? "",
    override_reason: row.override_reason ?? "",
    remarks: row.remarks ?? "",
  };
}

/**
 * The PATCH input for an edit: only what differs from `initial` (the values the editor opened
 * with). An emptied target class, section, reason or remarks is `null`, which clears the stored
 * one; text is compared trimmed, so a stray space is not an edit.
 */
export function buildDecisionUpdate(
  values: PromotionDecisionFormValues,
  initial: PromotionDecisionFormValues,
): UpdateDecisionInput {
  const update: UpdateDecisionInput = {};
  const clearable = (value: string) => value.trim() || null;
  if (values.decision !== initial.decision) update.decision = values.decision;
  if (clearable(values.to_class_id) !== clearable(initial.to_class_id)) {
    update.toClassId = clearable(values.to_class_id);
  }
  if (clearable(values.to_section_id) !== clearable(initial.to_section_id)) {
    update.toSectionId = clearable(values.to_section_id);
  }
  if (clearable(values.override_reason) !== clearable(initial.override_reason)) {
    update.overrideReason = clearable(values.override_reason);
  }
  if (clearable(values.remarks) !== clearable(initial.remarks)) {
    update.remarks = clearable(values.remarks);
  }
  return update;
}

/** True when an edit changes anything: with nothing changed, no request is made. */
export function hasDecisionChanges(update: UpdateDecisionInput): boolean {
  return Object.keys(update).length > 0;
}

/**
 * The target class and section the editor holds once the decision moves to `next`, mirroring the
 * server's rules: a graduating student has neither; a retained one stays in `fromClassId` (and
 * keeps its section only if that is already the class); a promotion can't stay in the class the
 * student is leaving, so one that came from retaining starts with no class. A new class always
 * means a new section, so that is the caller's to clear.
 */
export function targetsAfterDecisionChange(
  next: PromotionDecisionValue,
  current: Pick<PromotionDecisionFormValues, "to_class_id" | "to_section_id">,
  fromClassId: string,
): Pick<PromotionDecisionFormValues, "to_class_id" | "to_section_id"> {
  if (next === PROMOTION_DECISION.graduated) return { to_class_id: "", to_section_id: "" };
  if (next === PROMOTION_DECISION.retained) {
    return {
      to_class_id: fromClassId,
      to_section_id: current.to_class_id === fromClassId ? current.to_section_id : "",
    };
  }
  if (current.to_class_id === fromClassId) return { to_class_id: "", to_section_id: "" };
  return current;
}

function isDecisionValue(value: unknown): value is PromotionDecisionValue {
  return PROMOTION_DECISIONS.some((decision) => decision === value);
}

/**
 * What the server proposed for a row, read from `decision_basis`. That field is loosely typed
 * JSON and a row drafted before proposals were recorded has none, so anything short of both
 * `proposed_decision` and `proposed_to_class_id` is `null`: no proposal to deviate from.
 */
export function readPromotionProposal(basis: unknown): PromotionProposal | null {
  if (!isRecord(basis)) return null;
  const { proposed_decision: decision, proposed_to_class_id: toClassId } = basis;
  if (!isDecisionValue(decision)) return null;
  if (toClassId !== null && typeof toClassId !== "string") return null;
  return { decision, toClassId };
}

/**
 * True when the editor's decision or target class differs from the proposal, which is when the
 * server will ask for an override reason. With no recorded proposal (the server checks such a row
 * against today's next level, which the client can't see) only the decisions no proposal makes
 * are claimed.
 */
export function deviatesFromProposal(
  proposal: PromotionProposal | null,
  values: Pick<PromotionDecisionFormValues, "decision" | "to_class_id">,
): boolean {
  if (proposal === null) return PROMOTION_UNPROPOSED_DECISIONS.includes(values.decision);
  const toClassId = values.to_class_id || null;
  return values.decision !== proposal.decision || toClassId !== proposal.toClassId;
}

/** True for a row that will fail on execute: it moves on to a class but has no section. */
export function lacksTargetSection(row: PromotionDecisionRecord): boolean {
  return row.decision !== PROMOTION_DECISION.graduated && !row.to_section_id;
}

/** How many of a batch's rows lack a target section (see `lacksTargetSection`). */
export function countMissingSections(rows: readonly PromotionDecisionRecord[]): number {
  return rows.filter(lacksTargetSection).length;
}

/**
 * The rows whose student name or admission number contains `search`, ignoring case and
 * surrounding space; a blank search is every row.
 */
export function filterDecisionsBySearch(
  rows: readonly PromotionDecisionRecord[],
  search: string,
): PromotionDecisionRecord[] {
  const needle = search.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter(
    (row) =>
      row.student_name.toLowerCase().includes(needle) ||
      row.admission_number.toLowerCase().includes(needle),
  );
}
