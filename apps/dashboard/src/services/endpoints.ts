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
    students: "/students",
    staff: "/staff",
    /**
     * Id-scoped siblings of `staff`, not duplicates — same reasoning as `files.confirm`
     * below: `staffDetail` is a plain nested resource path (`PATCH /staff/{id}`), while
     * `staffExit` is a colon-action (`POST /staff/{id}:exit`, the real registered route
     * in `apps/api/apps/staff_management/staff/urls.py`, not a nested `/staff/{id}/exit`).
     */
    staffDetail: (id: string) => `/staff/${id}`,
    staffExit: (id: string) => `/staff/${id}:exit`,
    classes: "/classes",
    sections: "/sections",
    subjects: "/subjects",
    campuses: "/campuses",
    departments: "/departments",
    designations: "/designations",
    academicSessions: "/academic-sessions",
    teacherLoadSummary: "/teacher-subject-allocations/load-summary",
    myTimetable: "/timetables/my",
  },
  /**
   * The presigned upload flow (`core.files`, api-architecture.md §2.8) — real platform
   * infrastructure, not scoped to any one module. `confirm` is a colon-action, not a
   * nested path: the real registered route is `/files/{id}:confirm`
   * (`apps/api/core/files/urls.py`), not `/files/{id}/confirm`.
   */
  files: {
    create: "/files",
    confirm: (id: string) => `/files/${id}:confirm`,
  },
} as const;
