/**
 * Mirrors identifiers `apps/api/core/rbac/management/commands/seed_e2e_data.py` seeds.
 * There is no cross-language build-time coupling between the two — keep these in sync
 * manually if the Python side ever renames one — but centralizing the value here means
 * a second TS consumer greps to this file instead of hardcoding a second copy.
 */

/** Mirrors seed_e2e_data.py's E2E_OTHER_ADMIN_EMAIL. */
export const E2E_OTHER_ADMIN_EMAIL = "e2e-admin-other@schoolhub.test";

/** Mirrors seed_e2e_data.py's E2E_SCHOOL_ADMIN_EMAIL — a real, minimally-privileged
 * `school_admin` identity (only the keys the admission->enrollment journey needs), not
 * the all-permissions `school_owner` admin. */
export const E2E_SCHOOL_ADMIN_EMAIL = "e2e-school-admin@schoolhub.test";

/** Mirrors seed_e2e_data.py's E2E_STUDENT_EMAIL — a `student`-role user with
 * `RecordScope.OWN`, seeded with a real `Student` row linked via `user_id`. */
export const E2E_STUDENT_EMAIL = "e2e-student@schoolhub.test";

/**
 * Mirrors seed_e2e_data.py's E2E_PRINCIPAL_EMAIL — a `principal` identity holding
 * `academics.promotion.approve` and deliberately *not* `.execute`.
 *
 * It exists because academics.md §7.2 makes the approver a different person from the
 * preparer (`services.approve_batch` refuses a self-approval against the rows'
 * `created_by`): that rule cannot be proven with one identity, only refused.
 */
export const E2E_PRINCIPAL_EMAIL = "e2e-principal@schoolhub.test";

/**
 * Mirrors seed_e2e_data.py's baseline school_organization data — the admission->enrollment
 * browser journey selects these by their visible dropdown name (a real `<select>`'s
 * options aren't otherwise addressable without knowing the row's id up front).
 */
export const E2E_BASELINE_CAMPUS_NAME = "Main Campus";
export const E2E_BASELINE_CLASS_NAME = "Grade 1";
export const E2E_BASELINE_SECTION_NAME = "A";
export const E2E_BASELINE_SESSION_NAME = "E2E Baseline";

/**
 * Mirrors seed_e2e_data.py's academics baseline.
 *
 * The employee number is the *addressable* half of the seeded teacher: `Staff` ids are
 * generated per seed run, so a spec finds the row with `GET /staff?search=<number>`
 * (`StaffViewSet.search_fields` includes `employee_number`) rather than hardcoding a
 * uuid that changes every time the database is rebuilt.
 */
export const E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER = "E2E-TEACHER-1";
export const E2E_BASELINE_TEACHER_NAME = "E2E Teacher";
export const E2E_BASELINE_SUBJECT_NAME = "E2E Mathematics";
export const E2E_BASELINE_SUBJECT_CODE = "E2E-MATH";
