import { copyMappedFields } from "@/lib/helpers";
import type { SittingRecord } from "@/services/modules/exam-schedules/exam-schedules-type";
import type { ExamStatus } from "@/services/modules/exams/exams-type";
import {
  ADMIT_CARD_QUERY_FIELDS,
  ADMIT_CARD_STATUSES,
  ADMIT_CARD_STATUS_REVOKED,
  NOT_ISSUABLE_EXAM_STATUS,
} from "./admit-cards-constant";
import type { AdmitCardPageQuery, AdmitCardRecord, AdmitCardStatus } from "./admit-cards-type";

/** The admit-cards module's pure helpers: plain data in, plain data out. */

export function toAdmitCardQueryParams(
  query: AdmitCardPageQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  copyMappedFields(
    query,
    ADMIT_CARD_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | undefined>;
}

/** Cards print the schedule, so they are issued once it is published: any status past draft. */
export function isExamIssuable(status: ExamStatus): boolean {
  return status !== NOT_ISSUABLE_EXAM_STATUS;
}

export function isCardRevoked(card: AdmitCardRecord): boolean {
  return card.status === ADMIT_CARD_STATUS_REVOKED;
}

/** A PDF exists (the render job wrote it) and no revocation withdrew it: the part of the server's
 * `:download` rule a card shows (it also 404s a file not ready or retired). */
export function isCardDownloadable(card: AdmitCardRecord): boolean {
  return card.file_id !== null && !isCardRevoked(card);
}

/** `admit-card-<number>.pdf`, the name the render job stores it under. */
export function admitCardFilename(card: AdmitCardRecord): string {
  return `admit-card-${card.admit_card_no}.pdf`;
}

/** A finished render job's count of PDFs it wrote (`result.rendered`), or `null` without one. */
export function renderedCount(result: Record<string, unknown> | null): number | null {
  const rendered = result?.rendered;
  return typeof rendered === "number" ? rendered : null;
}

/** A URL status filter -> the query's status: `all`, or anything unknown, is no filter. */
export function statusFilterToStatus(value: string): AdmitCardStatus | undefined {
  return ADMIT_CARD_STATUSES.find((status) => status === value);
}

/** A section the exam sits in, as the section filter lists it. */
export interface ExamSection {
  id: string;
  className: string;
  sectionName: string;
}

/** The sections the exam's sittings name, once each, by class then section: the only sections it
 * issues cards to (`admit_card_candidates`). */
export function sectionsOfSittings(sittings: readonly SittingRecord[]): ExamSection[] {
  const sections = new Map<string, ExamSection>();
  for (const sitting of sittings) {
    sections.set(sitting.section_id, {
      id: sitting.section_id,
      className: sitting.class_name,
      sectionName: sitting.section_name,
    });
  }
  return [...sections.values()].sort(
    (a, b) => a.className.localeCompare(b.className) || a.sectionName.localeCompare(b.sectionName),
  );
}
