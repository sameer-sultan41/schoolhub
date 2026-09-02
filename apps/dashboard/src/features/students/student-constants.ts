/** Debounce window for the students-list search input — long enough to skip most
 * keystrokes, short enough that the result still feels live. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Page size sent to `GET /api/v1/students` — mirrors the API's own default
 * (core.api.pagination.CursorPagination), kept explicit here rather than relying
 * on the server's default so the UI's row count is a deliberate choice. */
export const STUDENTS_PAGE_SIZE = 25;
