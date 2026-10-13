import type { AcademicSessionSummary } from "./school-organization-type";

/** Session statuses that make its records read-only — mirrors `LOCKED_SESSION_STATES`
 * (`apps/api/apps/school_organization/services.py`); the API refuses the write either way. */
export const LOCKED_SESSION_STATUSES: readonly AcademicSessionSummary["status"][] = [
  "closed",
  "archived",
];
