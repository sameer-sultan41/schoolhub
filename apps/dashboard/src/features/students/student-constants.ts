/** Page size sent to `GET /api/v1/students` — mirrors the API's own default
 * (core.api.pagination.CursorPagination), kept explicit here rather than relying
 * on the server's default so the UI's row count is a deliberate choice. */
export const STUDENTS_PAGE_SIZE = 25;

/** Mirrors `apps.student_management.models.Relationship` — keep in sync. */
export const GUARDIAN_RELATIONSHIPS = [
  "father",
  "mother",
  "grandparent",
  "sibling",
  "legal_guardian",
  "other",
] as const;

/** Mirrors `apps.student_management.models.DEFAULT_DOCUMENT_TYPES`. A tenant may
 * extend this list server-side (TenantSettings.academic.student_document_types);
 * the dashboard has no endpoint to read those extras yet, so only the seeded
 * types are offered here — a documented gap, not an oversight. */
export const DEFAULT_DOCUMENT_TYPES = [
  "birth_certificate",
  "prior_transfer_certificate",
  "immunization_record",
  "photo_id",
  "prior_report_card",
  "other",
] as const;
