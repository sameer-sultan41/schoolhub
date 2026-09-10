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
    classes: "/classes",
    sections: "/sections",
    subjects: "/subjects",
    campuses: "/campuses",
    academicSessions: "/academic-sessions",
    teacherLoadSummary: "/teacher-subject-allocations/load-summary",
    myTimetable: "/timetables/my",
  },
} as const;
