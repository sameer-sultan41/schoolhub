import type { ApiMeta } from "@schoolhub/types";
import { copyMappedFields } from "@/lib/helpers";
import type { CurriculumRecord } from "@/services/modules/curriculum/curriculum-type";
import {
  ALLOCATION_CREATE_BODY_FIELDS,
  ALLOCATION_CREATE_ERROR_FIELDS,
  ALLOCATION_DEFAULT_IS_PRIMARY,
  ALLOCATION_EDIT_ERROR_FIELDS,
  ALLOCATION_QUERY_FIELDS,
  ALLOCATION_STATE,
  ALLOCATION_UPDATE_BODY_FIELDS,
} from "./teacher-allocations-constant";
import type { AllocationEditFormValues, AllocationFormValues } from "./teacher-allocations.schema";
import type {
  AllocateTeacherInput,
  AllocationSaveResult,
  TeacherAllocationPageQuery,
  TeacherAllocationRecord,
  TeacherLoadRow,
  TeacherLoadWarning,
  UpdateAllocationInput,
} from "./teacher-allocations-type";

/**
 * The teacher-allocations module's pure helper functions — plain data in, plain data out; no
 * React, no API calls.
 */

/**
 * `AllocateTeacherInput` -> the API's snake_case create body. Every field is sent as given:
 * `weekly_periods: null` ("no override") and `is_primary: false` are real values.
 * `effective_to` is never in it.
 */
export function toAllocationCreateBody(input: AllocateTeacherInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // Every field is required, never `undefined`: always include (else no-unnecessary-condition).
  copyMappedFields(input, ALLOCATION_CREATE_BODY_FIELDS, () => true, body);
  return body;
}

/** `UpdateAllocationInput` -> the snake_case PATCH body: only the keys present, nulls included. */
export function toAllocationUpdateBody(input: UpdateAllocationInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, ALLOCATION_UPDATE_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/**
 * `TeacherAllocationPageQuery` -> the list endpoint's query params. Unset and empty-string
 * filters are omitted ("no filter"); `current: false` is kept, since it filters to ended ones.
 */
export function toAllocationQueryParams(
  query: TeacherAllocationPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    ALLOCATION_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/**
 * A POST/PATCH answer's allocation with its `meta.warnings`. Missing meta, a missing key or a
 * non-list is "no warnings": a warning is advisory, so never fabricated and never an error.
 */
export function toAllocationSaveResult(
  allocation: TeacherAllocationRecord,
  meta: ApiMeta | undefined,
): AllocationSaveResult {
  const warnings = meta?.warnings;
  return {
    allocation,
    warnings: Array.isArray(warnings) ? (warnings as TeacherLoadWarning[]) : [],
  };
}

/** The state filter -> the API's `current` flag: `all` (or anything else) is no filter. */
export function allocationStateToCurrent(state: string): boolean | undefined {
  if (state === ALLOCATION_STATE.current) return true;
  if (state === ALLOCATION_STATE.ended) return false;
  return undefined;
}

/** An ended allocation has an end date: it stays as history and can be reinstated. */
export function isAllocationEnded(record: TeacherAllocationRecord): boolean {
  return (record.effective_to ?? null) !== null;
}

/** Whether `today` (an ISO date) is on or after the allocation's start; no start date counts
 * as started. ISO dates compare as text. */
export function hasAllocationStarted(record: TeacherAllocationRecord, today: string): boolean {
  const from = record.effective_from ?? null;
  return from === null || from <= today;
}

/** A current allocation that has started can be ended; one that hasn't started yet can only
 * be removed, as there is nothing to end. */
export function canEndAllocation(record: TeacherAllocationRecord, today: string): boolean {
  return !isAllocationEnded(record) && hasAllocationStarted(record, today);
}

/** Whether an allocation is the primary teacher; the model's default when the key is absent. */
export function isPrimaryAllocation(record: TeacherAllocationRecord): boolean {
  return record.is_primary ?? ALLOCATION_DEFAULT_IS_PRIMARY;
}

/**
 * The fields a server error may be shown under on the form. An edit shows the identity fields
 * read-only, so an error naming one has no input to show under: it is left out, and the
 * caller shows that error as the form's own message instead.
 */
export function allocationErrorFields(mode: "create" | "edit"): readonly string[] {
  return mode === "edit" ? ALLOCATION_EDIT_ERROR_FIELDS : ALLOCATION_CREATE_ERROR_FIELDS;
}

/** A new allocation's form values: primary, with no override and no start date. */
export function defaultAllocationFormValues(): AllocationFormValues {
  return {
    class_id: "",
    section_id: "",
    subject_id: "",
    staff_id: "",
    is_primary: ALLOCATION_DEFAULT_IS_PRIMARY,
    weekly_periods: "",
    effective_from: "",
  };
}

/** An existing allocation's editable form values; no override or start date is `""`. */
export function recordToAllocationFormValues(
  record: TeacherAllocationRecord,
): AllocationEditFormValues {
  const weeklyPeriods = record.weekly_periods ?? null;
  return {
    is_primary: isPrimaryAllocation(record),
    weekly_periods: weeklyPeriods === null ? "" : String(weeklyPeriods),
    effective_from: record.effective_from ?? "",
  };
}

/** The weekly-periods text -> the wire value: blank is `null` ("use the curriculum's"). */
function periodsOrNull(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

/** A blank date -> `null`, the wire's "no start date". */
function dateOrNull(text: string): string | null {
  return text === "" ? null : text;
}

/** The allocate form's values -> the service input. The class only drove the pickers. */
export function buildAllocateInput(
  values: AllocationFormValues,
  academicSessionId: string,
): AllocateTeacherInput {
  return {
    academicSessionId,
    sectionId: values.section_id,
    subjectId: values.subject_id,
    staffId: values.staff_id,
    isPrimary: values.is_primary,
    weeklyPeriods: periodsOrNull(values.weekly_periods),
    effectiveFrom: dateOrNull(values.effective_from),
  };
}

/**
 * The edit form's values -> the PATCH input: only the editable fields that differ from
 * `initial` (the form's values when it opened), never `effectiveTo` (End and Reinstate own it)
 * or the identity. Untouched fields stay out, as the server re-validates whatever it is sent: a
 * row displaced from a future start carries a future `effective_to`, and resending its
 * `effective_from` would be refused as "ended in the future". A blank override is `null`: clear it.
 * The override is compared as a number, so retyping `5` as `05` is not a change.
 */
export function buildAllocationUpdate(
  values: AllocationEditFormValues,
  initial: AllocationEditFormValues,
): UpdateAllocationInput {
  const update: UpdateAllocationInput = {};
  if (values.is_primary !== initial.is_primary) update.isPrimary = values.is_primary;
  const weeklyPeriods = periodsOrNull(values.weekly_periods);
  if (weeklyPeriods !== periodsOrNull(initial.weekly_periods)) update.weeklyPeriods = weeklyPeriods;
  if (values.effective_from !== initial.effective_from) {
    update.effectiveFrom = dateOrNull(values.effective_from);
  }
  return update;
}

/** Whether an update changes anything: an edit that doesn't is not sent at all. */
export function hasAllocationChanges(update: UpdateAllocationInput): boolean {
  return Object.keys(update).length > 0;
}

/** A class's curriculum -> its distinct subjects, in the curriculum's order: the same subject
 * can be mapped once per campus, and a picker offers it once. */
export function curriculumToSubjectOptions(
  records: readonly CurriculumRecord[],
): { id: string; name: string }[] {
  const seen = new Set<string>();
  const options: { id: string; name: string }[] = [];
  for (const record of records) {
    if (seen.has(record.subject_id)) continue;
    seen.add(record.subject_id);
    options.push({ id: record.subject_id, name: record.subject_name });
  }
  return options;
}

/** The load summary with over-norm teachers first; the server's order otherwise holds. */
export function sortOverNormFirst(rows: readonly TeacherLoadRow[]): TeacherLoadRow[] {
  return [...rows].sort((a, b) => Number(b.over_norm) - Number(a.over_norm));
}
