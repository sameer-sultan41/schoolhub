/**
 * Every API endpoint path the dashboard calls, grouped by domain.
 *
 * A component never reads this file directly and never hardcodes a path string of its
 * own: it calls `Services.<domain>.<action>(...)` (see `src/services/index.ts`), and that
 * domain's own `services/modules/<domain>/` file is the one place that reads
 * `endpoints.<domain>.*`.
 *
 * Scoped to only what the `/dashboard` route's widgets need today — this branch has no
 * other module screens yet (see AGENTS.md's Adding a Module Screen for the convention
 * to follow when the next one lands).
 */
export const endpoints = {
  auth: {
    me: "/auth/me",
  },
  dashboard: {
    students: "/students",
    staff: "/staff",
    /**
     * Id-scoped siblings of `staff`, not duplicates — same reasoning as `files.confirm`
     * below: `staffDetail` is a plain nested resource path (`PATCH /staff/{id}`), while
     * `staffExit` is a colon-action (`POST /staff/{id}:exit`, the real registered route
     * in `apps/api/apps/staff_management/urls.py`, not a nested `/staff/{id}/exit`).
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
   * (`apps/api/core/files/urls.py`), not `/files/{id}/confirm` — this is the first
   * endpoint entry in this file that needs an id interpolated into the path, so it's a
   * function rather than a plain string; every other entry above stays a plain string.
   */
  files: {
    create: "/files",
    confirm: (id: string) => `/files/${id}:confirm`,
  },
} as const;
