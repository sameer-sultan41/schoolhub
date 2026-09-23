/**
 * Every API endpoint path the dashboard calls, grouped by domain.
 *
 * A path is either a static string, or — when it needs a value only known at call time
 * (an id, a slug) — a function returning one, e.g. `students: { detail: (id: string) =>
 * `/students/${id}` }`. A component never reads this file directly and never hardcodes a
 * path string of its own: it calls `Services.<domain>.<action>(...)` (see
 * `src/services/index.ts`), and that domain's own `services/modules/<domain>/` file is the
 * one place that reads `endpoints.<domain>.*`. The one exception is `src/lib/auth.ts`'s own
 * client wiring (the transport layer's internal refresh-retry, which runs before any
 * service function does) — infrastructure, not a module's API call, but it still reads its
 * one path from here rather than hardcoding it.
 *
 * `dashboard`'s entries overlap in places with other backend areas — `classes` and
 * `sections` are also read by school-organization work that has no dashboard service of
 * its own yet. That's accepted for now rather than invented away with speculative
 * domains the app doesn't have module screens for. When a real `school-organization`
 * module lands, these two constants can move there instead of staying duplicated.
 *
 * Add a new domain the moment a real module needs one — this file has exactly the paths
 * this app actually calls today, nothing speculative.
 */
export const endpoints = {
  auth: {
    login: "/login",
    logout: "/logout",
    me: "/auth/me",
    refresh: "/refresh",
  },
  tenant: {
    /** The authenticated user's own tenant — name, branding, locale, contact. */
    current: "/tenant",
  },
  dashboard: {
    classes: "/classes",
    sections: "/sections",
    subjects: "/subjects",
    rooms: "/rooms",
    houses: "/houses",
    campuses: "/campuses",
    students: "/students",
    staff: "/staff",
    academicSessions: "/academic-sessions",
    teacherLoadSummary: "/teacher-subject-allocations/load-summary",
    teacherSubstitutions: "/teacher-substitutions",
    studentPromotions: "/student-promotions",
    myTimetable: "/timetables/my",
    periods: "/periods",
  },
} as const;
