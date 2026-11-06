import type { ApiSchemas } from "@schoolhub/api-client";

/**
 * What every `/reports/<module>-summary` endpoint shares: a too-large inline run and every export
 * are a `202` + job whose result names the file. The attendance and exam reports read these.
 */

/** The export formats `core.exports.tabular` renders. */
export type ReportFormat = ApiSchemas["FormatEnum"];

/** The export formats, in the buttons' order (`core.exports.tabular.FORMATS`). */
export const REPORT_EXPORT_FORMATS: readonly ReportFormat[] = ["csv", "xlsx", "pdf"];

/** The format a too-large inline run is built in: the API's default. */
export const QUEUED_REPORT_FORMAT: ReportFormat = "csv";

/** A finished report job's file id, read without trusting the result's shape. */
export function jobResultFileId(result: Record<string, unknown> | null | undefined): string | null {
  const fileId = result?.result_file_id;
  return typeof fileId === "string" ? fileId : null;
}
