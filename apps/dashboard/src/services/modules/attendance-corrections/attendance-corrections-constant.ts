/** The attendance-corrections module's constants. */

/** `AttendanceCorrection.reason`'s `max_length`. */
export const CORRECTION_REASON_MAX_LENGTH = 500;

/**
 * The fields a server error may name in the request dialog: the serializer's `new_values`
 * checks arrive flattened as `new_values.<field>`. Any other field, `new_values` itself (the
 * "values match the record" and `on_leave` refusals) included, is the dialog's own message.
 */
export const CORRECTION_ERROR_FIELDS = [
  "new_values.status",
  "new_values.check_in_time",
  "new_values.check_out_time",
  "new_values.remarks",
  "reason",
] as const;
