import type { MessageThreadCreateBody } from "@/services/modules/message-threads/message-threads-type";
import {
  createNewThreadSchema,
  type NewThreadFormValues,
} from "@/services/modules/message-threads/message-threads.schema";

export { createNewThreadSchema };
export type { NewThreadFormValues };

export const NEW_THREAD_DEFAULTS: NewThreadFormValues = {
  thread_type: "guardian_school",
  subject: "",
  body: "",
  student: null,
  participants: [],
};

/** The request body: a guardian thread sends the student, the others the participants. */
export function buildNewThreadInput(values: NewThreadFormValues): MessageThreadCreateBody {
  const base = { subject: values.subject, thread_type: values.thread_type, body: values.body };
  if (values.thread_type === "guardian_school") {
    return { ...base, student_id: values.student?.id ?? null };
  }
  return { ...base, participant_user_ids: values.participants.map((p) => p.user_id) };
}
