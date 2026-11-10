import { z } from "zod";

import { REMARKS_MAX_LENGTH } from "./report-cards-constant";

/** The remarks form's schema, with the API's own field names. Both fields are optional: the
 * dialog renders only the ones the viewer may write, and a blank one clears the remark. */

export function createRemarksFormSchema(tooLong: string) {
  const remark = z.string().max(REMARKS_MAX_LENGTH, tooLong);
  return z.object({ class_teacher_remarks: remark, principal_remarks: remark });
}

export type RemarksFormValues = z.infer<ReturnType<typeof createRemarksFormSchema>>;
