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
    // `level` is unique per tenant (the promotion ladder) — well clear of the seeded
    // baseline class (level 1) and any other live spec's own random level.
    level: 1000 + Math.floor(Math.random() * 1_000_000),
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
 * A date window far enough from the seeded baseline session (roughly the current year)
 * to trivially avoid `assert_no_session_overlap` without reading the baseline's own dates.
 */
export function farFutureSessionWindow(): { start_date: string; end_date: string } {
  const start = new Date();
  start.setFullYear(start.getFullYear() + 10, 0, 1 + Math.floor(Math.random() * 300));
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
