/** Debounce window for the staff-list search input — mirrors
 * student-constants.ts's SEARCH_DEBOUNCE_MS. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Page size sent to `GET /api/v1/staff` — mirrors the API's own default
 * (core.api.pagination.CursorPagination), kept explicit here rather than relying
 * on the server's default so the UI's row count is a deliberate choice. */
export const STAFF_PAGE_SIZE = 25;

/** Mirrors `apps.staff_management.models.DEFAULT_DOCUMENT_TYPES`. A tenant may
 * extend this list server-side (TenantSettings.hr.staff_document_types); the
 * dashboard has no endpoint to read those extras yet, so only the seeded
 * types are offered here — a documented gap, not an oversight. */
export const DEFAULT_DOCUMENT_TYPES = [
  "contract",
  "national_id",
  "resume",
  "police_clearance",
  "medical_certificate",
  "other",
] as const;
