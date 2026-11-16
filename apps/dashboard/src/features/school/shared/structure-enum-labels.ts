import type { AcademicSessionStatus, SubjectType } from "@/services";

/** Message keys (in the `school` namespace) for each session status, read through `enumLabel`. */
export const SESSION_STATUS_LABEL_KEY: Record<AcademicSessionStatus, string> = {
  planned: "sessions.status.planned",
  active: "sessions.status.active",
  closed: "sessions.status.closed",
  archived: "sessions.status.archived",
};

/** Message keys (in the `school` namespace) for each subject type, read through `enumLabel`. */
export const SUBJECT_TYPE_LABEL_KEY: Record<SubjectType, string> = {
  core: "subjects.types.core",
  elective: "subjects.types.elective",
  co_curricular: "subjects.types.co_curricular",
};
