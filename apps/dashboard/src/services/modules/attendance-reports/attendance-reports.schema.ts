import { z } from "zod";

/**
 * The defaulters threshold as the API validates it (`AttendanceReportQuerySerializer`): a
 * percentage from 0 to 100 with at most one decimal place. The rest of the report form is
 * URL state checked by `REPORT_URL_FILTERS`, not a Zod form.
 */

export const REPORT_THRESHOLD_MIN = 0;
export const REPORT_THRESHOLD_MAX = 100;
/** `max_digits=4, decimal_places=1`. */
const ONE_DECIMAL_NUMBER = /^\d{1,3}(\.\d)?$/;

export const reportThresholdSchema = z
  .string()
  .trim()
  .regex(ONE_DECIMAL_NUMBER)
  .refine((value) => {
    const number = Number(value);
    return number >= REPORT_THRESHOLD_MIN && number <= REPORT_THRESHOLD_MAX;
  });

export type ReportThreshold = z.infer<typeof reportThresholdSchema>;

/** Whether `value` is a threshold the API accepts. */
export function isValidThreshold(value: string): boolean {
  return reportThresholdSchema.safeParse(value).success;
}
