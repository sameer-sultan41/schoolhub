import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import { FEE_STRUCTURES_BODY_FIELDS, FEE_STRUCTURES_QUERY_FIELDS } from "./fee-structures-constant";
import type { FeeStructureFormValues } from "./fee-structures.schema";
import type {
  FeeStructureInput,
  FeeStructureRecord,
  FeeStructuresQuery,
  FeeStructureStatus,
} from "./fee-structures-type";

/** The fee-structures module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toFeeStructuresQueryParams(query: FeeStructuresQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    FEE_STRUCTURES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toFeeStructureBody(input: Partial<FeeStructureInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, FEE_STRUCTURES_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** A URL filter's picked value, or `undefined` for "all" (no filter sent). */
export function feeStructureStatusFilter(value: string): FeeStructureStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as FeeStructureStatus);
}

/** Only a draft structure's name, scope and schedules may change (`assert_structure_is_editable`). */
export function isStructureEditable(structure: Pick<FeeStructureRecord, "status">): boolean {
  return structure.status === "draft";
}

export function defaultFeeStructureFormValues(): FeeStructureFormValues {
  return { name: "", academic_session: "", school_class: "", campus: "" };
}

export function recordToFeeStructureFormValues(record: FeeStructureRecord): FeeStructureFormValues {
  return {
    name: record.name,
    academic_session: record.academic_session,
    school_class: record.school_class ?? "",
    campus: record.campus ?? "",
  };
}

/** Form values -> the service input; no class or campus is a structure for every one (`null`). */
export function buildFeeStructureInput(values: FeeStructureFormValues): FeeStructureInput {
  return {
    name: values.name.trim(),
    academicSessionId: values.academic_session,
    classId: values.school_class === "" ? null : values.school_class,
    campusId: values.campus === "" ? null : values.campus,
  };
}
