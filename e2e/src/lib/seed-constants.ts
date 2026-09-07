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
 * Mirrors seed_e2e_data.py's E2E_CLASS_TEACHER_EMAIL — the only seeded identity
 * holding `attendance.student-attendance.mark`. §4 grants marking to
 * `teacher`/`class_teacher` and to nobody else, so the school-admin fixture
 * deliberately does not have it: a widened admin would let a spec assert a
 * permission the module does not actually grant. Also §7.2's level-1 leave
 * approver.
 */
export const E2E_CLASS_TEACHER_EMAIL = "e2e-class-teacher@schoolhub.test";

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

/**
 * Mirrors seed_e2e_data.py's timetable baseline.
 *
 * The *second* teacher exists only so a substitution has two sides: §11 and the
 * `substitutions_substitute_differs_from_absentee` check constraint both refuse a
 * substitute who is the absentee, so one teacher can only ever demonstrate the refusal.
 * Addressed by employee number for the same reason the first one is — `Staff` ids are
 * generated per seed run.
 */
export const E2E_BASELINE_SUBSTITUTE_EMPLOYEE_NUMBER = "E2E-TEACHER-2";

/**
 * The seeded bell schedule is **tenant-wide** (`campus_id === null`), which two things
 * depend on:
 *
 * - a spec may build its grid on its own run-unique campus without tripping
 *   `period_wrong_campus`, a hard conflict;
 * - a spec creating its *own* period must stay clear of 08:00-11:20, because
 *   `assert_period_does_not_overlap` compares against tenant-wide rows too
 *   (`buildLivePeriod` puts them in the evening for exactly this reason).
 *
 * The names below are what the week grid renders as its row headers, and the cell
 * buttons' accessible names are built from them ("Fill Monday · Period 1").
 */
export const E2E_BASELINE_FIRST_PERIOD_NAME = "Period 1";
export const E2E_BASELINE_BREAK_PERIOD_NAME = "Recess";

/**
 * Mirrors the `reason` on the one substitution seed_e2e_data.py leaves in `proposed`.
 *
 * It is the only addressable attribute: the row's id, its slot and its date are all
 * generated per seed run. A spec that decides this proposal has consumed the fixture —
 * anything needing a decidable proposal of its own builds one through the API.
 */
export const E2E_BASELINE_SUBSTITUTION_REASON = "e2e live-lane fixture";
