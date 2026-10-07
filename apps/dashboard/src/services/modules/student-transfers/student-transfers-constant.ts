/** The student-transfers module's constants.
 *
 * No per-page-size constant here: `fetchStudentTransfers` reuses
 * `@schoolhub/api-client`'s own `MAX_PAGE_SIZE` directly, matching
 * `school-organization-service.ts`'s `fetchHouses` — a single student's transfer
 * history is always small and bounded, the same reasoning that gave
 * `students-constant.ts`'s `RELATION_PAGE_SIZE` its own small cap, just reusing the
 * shared constant instead of a fourth near-identical one.
 */
export {};
