import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). Only the two remark fields are writable (`PATCH`). */
export type ReportCardRecord = ApiSchemas["ReportCard"];
export type ReportCardStatus = ApiSchemas["ReportCardStatusEnum"];
export type ReportCardsPublished = ApiSchemas["ReportCardsPublished"];
export type ReportCardDownload = ApiSchemas["CardDownload"];

/** A remarks `PATCH`: the generated body narrowed to its two writable fields, each written by its
 * own key (`ReportCardViewSet.REMARK_FIELD_KEYS`) and sent only when the caller may write it. A
 * blank remark clears it (`null`). */
export type ReportCardRemarksInput = Pick<
  ApiSchemas["PatchedReportCard"],
  "class_teacher_remarks" | "principal_remarks"
>;
export type ReportCardRemarkField = keyof ReportCardRemarksInput;

/** One cursor page of one exam's cards. */
export interface ReportCardPageQuery {
  examId: string;
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  sectionId?: string;
  status?: ReportCardStatus;
}
