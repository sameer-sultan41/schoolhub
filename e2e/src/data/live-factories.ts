/**
 * Data builders for the live API lane (`e2e/tests/live/api/`).
 *
 * Deliberately separate from `@/data/factories`, which builds API-*shaped* objects for
 * stubbing with stable sequential ids so a mocked trace reads the same every run. These
 * builders create real rows in a real, possibly-persistent database instead, where that
 * property is exactly wrong: every value below is run-unique so a rerun against a dev
 * database that was never reset cannot collide with yesterday's leftover rows — which
 * matters most for `AcademicSession`/`Term`, since neither has a destroy endpoint
 * (`AcademicSessionViewSet`'s own docstring: a session is closed, never deleted, to keep
 * history addressable), so old rows are never cleaned up between runs.
 */

/** Compact, effectively-collision-free per-call tag — no dependency on a test's worker index. */
function uniqueTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildLiveCampus(overrides: Partial<{ name: string; code: string }> = {}) {
  const tag = uniqueTag();
  return {
    name: `E2E Campus ${tag}`,
    code: `E2E${tag}`.slice(0, 20),
    is_active: true,
    ...overrides,
  };
}

export function buildLiveDepartment(overrides: Partial<{ name: string; code: string }> = {}) {
  const tag = uniqueTag();
  return {
    name: `E2E Department ${tag}`,
    code: `E2E${tag}`.slice(0, 20),
    is_active: true,
    ...overrides,
  };
}

export function buildLiveClass(overrides: Partial<{ name: string; level: number }> = {}) {
  const tag = uniqueTag();
  return {
    name: `E2E Class ${tag}`,
    // `level` is unique per tenant (the promotion ladder) and a Postgres SMALLINT column
    // (max 32767 — confirmed against the real API, which rejected an earlier version of
    // this range with "Ensure this value is less than or equal to 32767") — well clear of
    // both that ceiling and the seeded baseline class (level 1).
    level: 100 + Math.floor(Math.random() * 30_000),
    is_active: true,
    ...overrides,
  };
}

export function buildLiveSection(
  overrides: Partial<{ name: string; capacity: number | null }> = {},
) {
  const tag = uniqueTag();
  return {
    name: `E2E-${tag}`.slice(0, 30),
    capacity: 30,
    is_active: true,
    ...overrides,
  };
}

export function buildLiveSubject(overrides: Partial<{ name: string; code: string }> = {}) {
  const tag = uniqueTag();
  return {
    name: `E2E Subject ${tag}`,
    code: `E2E${tag}`.slice(0, 20),
    is_active: true,
    ...overrides,
  };
}

export function buildLiveHouse(overrides: Partial<{ name: string; code: string }> = {}) {
  const tag = uniqueTag();
  return {
    name: `E2E House ${tag}`,
    code: `E2E${tag}`.slice(0, 20),
    is_active: true,
    ...overrides,
  };
}

/**
 * A student the promotion lane can enroll and then promote.
 *
 * `last_name` carries the unique tag, not `first_name`: `services.assert_not_duplicate`
 * rejects an exact first-name + last-name + date-of-birth match (student-management §11),
 * so a fixed name would make the *second* run of any promotion spec fail as a duplicate
 * admission rather than for anything to do with promotion.
 */
export function buildLiveStudent(overrides: Partial<{ first_name: string }> = {}) {
  const tag = uniqueTag();
  return {
    first_name: "E2E",
    last_name: `Rollover ${tag}`,
    date_of_birth: "2015-05-05",
    gender: "unspecified",
    admission_date: "2026-01-01",
    ...overrides,
  };
}

/** A guardian — `enroll_student` refuses a student with no guardian link (§11). */
export function buildLiveGuardian() {
  const tag = uniqueTag();
  return {
    first_name: "E2E",
    last_name: `Guardian ${tag}`,
    phone: "+15551234567",
  };
}

/** An emergency contact — the other half of `assert_enrollment_prerequisites`. */
export function buildLiveEmergencyContact() {
  const tag = uniqueTag();
  return {
    name: `E2E Contact ${tag}`,
    relationship: "Mother",
    phone: "+15551234567",
  };
}

/**
 * A date window far enough from the seeded baseline session (roughly the current year)
 * to trivially avoid `assert_no_session_overlap` without reading the baseline's own dates
 * — and far enough from *every other call's* window, in this run or an earlier one, to
 * avoid colliding with it either. `AcademicSession` has no destroy endpoint
 * (`AcademicSessionViewSet`'s own docstring), so every prior run's rows are still there
 * for a new run to collide with; there is no server-side "is this window free?" check to
 * ask instead, so this leans on a wide enough spread that a real collision is negligible.
 *
 * Two prior versions both proved too narrow against the real API (not assumed): a single
 * random day offset within one future year let two 364-day windows in the same run
 * overlap, and a later fix based on the current second was still only a few hundred days
 * apart for two runs a few minutes apart — exactly what iterating on this file locally
 * does. `sequence` still guarantees calls *within* one run never overlap (800-day steps);
 * the random component now spans ~1,400 years, wide enough that even back-to-back reruns
 * land nowhere near each other.
 */
let sequence = 0;
export function farFutureSessionWindow(): { start_date: string; end_date: string } {
  sequence += 1;
  const baseDays = 3650 + Math.floor(Math.random() * 500_000) + sequence * 800;
  const start = new Date();
  start.setDate(start.getDate() + baseDays);
  const end = new Date(start);
  end.setDate(end.getDate() + 364);
  return { start_date: isoDate(start), end_date: isoDate(end) };
}

export function buildLiveAcademicSession(
  overrides: Partial<{ name: string; start_date: string; end_date: string }> = {},
) {
  const tag = uniqueTag();
  return {
    name: `E2E Session ${tag}`,
    ...farFutureSessionWindow(),
    ...overrides,
  };
}

/**
 * A term covering exactly `session`'s window — `session_completeness_errors` requires the
 * first/last term to fully cover the session's start/end dates, so a one-term calendar must
 * match them exactly rather than nest strictly inside.
 */
export function buildLiveTerm(
  session: { start_date: string; end_date: string },
  overrides: Partial<{ name: string; sequence: number }> = {},
) {
  const tag = uniqueTag();
  return {
    name: `E2E Term ${tag}`,
    sequence: 1,
    start_date: session.start_date,
    end_date: session.end_date,
    ...overrides,
  };
}
