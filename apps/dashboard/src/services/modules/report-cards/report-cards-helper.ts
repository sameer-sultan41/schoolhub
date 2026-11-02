import type { PermissionKey } from "@schoolhub/types";

import { copyMappedFields } from "@/lib/helpers";
import {
  REMARK_FIELD_KEYS,
  REPORT_CARD_QUERY_FIELDS,
  REPORT_CARD_STATUSES,
  REPORT_CARD_STATUS_PUBLISHED,
} from "./report-cards-constant";
import type {
  ReportCardPageQuery,
  ReportCardRecord,
  ReportCardRemarkField,
  ReportCardRemarksInput,
  ReportCardStatus,
} from "./report-cards-type";

/** The report-cards module's pure helpers: plain data in, plain data out. */

export function toReportCardQueryParams(
  query: ReportCardPageQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  copyMappedFields(
    query,
    REPORT_CARD_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | undefined>;
}

/** A URL status filter -> the query's status: `all`, or anything unknown, is no filter. */
export function reportCardStatusFilter(value: string): ReportCardStatus | undefined {
  return REPORT_CARD_STATUSES.find((status) => status === value);
}

/** The remark fields a caller may write, in the form's order: each needs its own key. */
export function writableRemarkFields(
  can: (key: PermissionKey) => boolean,
): ReportCardRemarkField[] {
  return REMARK_FIELD_KEYS.filter(([, key]) => can(key)).map(([field]) => field);
}

/** Remarks change only on an unpublished card: a published one is regenerated instead (409). */
export function areRemarksEditable(card: ReportCardRecord): boolean {
  return card.status !== REPORT_CARD_STATUS_PUBLISHED;
}

/** A PDF exists (the generation job wrote it): the part of `:download`'s rule a card shows. */
export function isReportCardDownloadable(card: ReportCardRecord): boolean {
  return card.file_id !== null;
}

/** `report-card-<admission number>-v<version>.pdf`, the name the render job stores it under. */
export function reportCardFilename(card: ReportCardRecord): string {
  return `report-card-${card.admission_number}-v${String(card.version)}.pdf`;
}

/** The `PATCH` body: only `fields`, each trimmed, a blank one cleared (`null`). */
export function toRemarksBody(
  values: Partial<Record<ReportCardRemarkField, string>>,
  fields: readonly ReportCardRemarkField[],
): ReportCardRemarksInput {
  const body: ReportCardRemarksInput = {};
  for (const field of fields) {
    const value = (values[field] ?? "").trim();
    body[field] = value === "" ? null : value;
  }
  return body;
}

/** A finished generation job's count of cards that failed to render (`result.failed`, one entry
 * per card); `0` without the list. Those cards stay drafts, and a re-run picks them up. */
export function failedRenderCount(result: Record<string, unknown> | null): number {
  const failed = result?.failed;
  return Array.isArray(failed) ? failed.length : 0;
}
