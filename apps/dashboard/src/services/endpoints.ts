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
    /** `POST /staff-exports`/`POST /staff-imports` -> `202` + job
     * (`apps/api/apps/staff_management/staff/urls.py`) — each queues a `core.jobs`
     * background job; poll it via `jobs.detail` below. */
    staffExports: "/staff-exports",
    staffImports: "/staff-imports",
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
    /** Colon-action, not a nested path — the real registered route is
     * `/files/{id}:download` (`apps/api/core/files/urls.py`). Returns
     * `{download_url}`, a signed, time-limited URL the browser can navigate to
     * directly — never proxied through this API. */
    download: (id: string) => `/files/${id}:download`,
  },
  /**
   * `core.jobs` — the generic `202 + job` polling contract any long-running endpoint
   * hands back a `job_id` for (staff import/export today; more later). Not
   * module-specific, same reasoning as `files` above.
   */
  jobs: {
    detail: (id: string) => `/jobs/${id}`,
  },
  schoolOrganization: {
    houses: "/houses",
    /**
     * Separate from `dashboard.classes`/`.sections`/`.academicSessions` above: those are
     * read only for `fetchDashboardOverview`'s counts, these are read for option-list
     * fetchers. Both sets point at the same real paths — two named callers of one URL,
     * not a duplication to clean up.
     */
    classes: "/classes",
    sections: "/sections",
    academicSessions: "/academic-sessions",
  },
  students: {
    list: "/students",
    detail: (id: string) => `/students/${id}`,
    /** Colon-action, not a nested path — the real registered route is
     * `/students/{id}:withdraw`. */
    withdraw: (id: string) => `/students/${id}:withdraw`,
    /** Colon-actions, not nested paths — the real registered routes are
     * `/students/{id}:enroll`/`/students/{id}:change-section`. */
    enroll: (id: string) => `/students/${id}:enroll`,
    changeSection: (id: string) => `/students/${id}:change-section`,
    history: (id: string) => `/students/${id}/history`,
    emergencyContacts: (studentId: string) => `/students/${studentId}/emergency-contacts`,
    documents: (studentId: string) => `/students/${studentId}/documents`,
  },
  /** Top-level access to a single document — `DELETE` and the `:verify`/`:download`
   * colon-actions. Upload (create) always goes through the nested `students.documents`
   * path above, where the student is unambiguous from the URL. */
  studentDocuments: {
    detail: (id: string) => `/student-documents/${id}`,
    verify: (id: string) => `/student-documents/${id}:verify`,
    download: (id: string) => `/student-documents/${id}:download`,
  },
  guardians: {
    list: "/guardians",
    detail: (id: string) => `/guardians/${id}`,
    /** Nested under one student — `GET` lists that student's links, `POST` creates one.
     * The guardian itself is not created here (see `guardians.list` above). */
    studentLinks: (studentId: string) => `/students/${studentId}/guardians`,
  },
  /** Top-level access to a single link — `PATCH` only (module doc §16: "link flags
   * updatable via PATCH /api/v1/student-guardians/{id}"). */
  studentGuardians: {
    detail: (id: string) => `/student-guardians/${id}`,
  },
} as const;
