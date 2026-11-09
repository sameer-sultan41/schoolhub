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
    changePassword: "/auth/change-password",
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
    subjects: "/subjects",
    academicSessions: "/academic-sessions",
    /** Filtered by `academic_session_id`; governed by the academic-session permission keys. */
    terms: "/terms",
  },
  /** Curriculum mapping (`class_subjects` in the database) is served at `/class-subjects`
   * (`apps/api/apps/academics/curriculum/urls.py`). */
  curriculum: {
    list: "/class-subjects",
    detail: (id: string) => `/class-subjects/${id}`,
    /** Collection colon-action, synchronous 200 with `{created, skipped}`. */
    clone: "/class-subjects:clone",
  },
  /** `/teacher-subject-allocations` (`apps/api/apps/academics/teacher_allocations/urls.py`). */
  teacherAllocations: {
    list: "/teacher-subject-allocations",
    detail: (id: string) => `/teacher-subject-allocations/${id}`,
    loadSummary: "/teacher-subject-allocations/load-summary",
  },
  /** The bell schedule (`apps/api/apps/timetable/periods/urls.py`). */
  periods: {
    list: "/periods",
    detail: (id: string) => `/periods/${id}`,
  },
  /** The week grid: `/timetable-slots`, and the section colon-actions on `/timetables/{id}`,
   * where the id is a **section** id (`apps/api/apps/timetable/slots/urls.py`). */
  timetableSlots: {
    list: "/timetable-slots",
    detail: (id: string) => `/timetable-slots/${id}`,
    validate: (sectionId: string) => `/timetables/${sectionId}:validate`,
    publish: (sectionId: string) => `/timetables/${sectionId}:publish`,
    /** The viewer's own effective week: a teacher's classes and cover, a learner's section. */
    my: "/timetables/my",
  },
  /** Cover: `/teacher-substitutions`, its colon-actions and the free-teacher lookup
   * (`apps/api/apps/timetable/substitutions/urls.py`). */
  teacherSubstitutions: {
    list: "/teacher-substitutions",
    candidates: "/teacher-substitutions/candidates",
    action: (id: string, action: "approve" | "reject" | "cancel") =>
      `/teacher-substitutions/${id}:${action}`,
  },
  /** `GET/PATCH /attendance-settings` (`apps/api/apps/attendance/urls.py`): one row per tenant. */
  attendanceSettings: {
    detail: "/attendance-settings",
  },
  /** `apps/api/apps/attendance/urls.py`: `:bulk-mark` is a colon-action on the collection. */
  studentAttendance: {
    list: "/student-attendance",
    register: "/student-attendance/register",
    myRegisters: "/student-attendance/my-registers",
    bulkMark: "/student-attendance:bulk-mark",
    /** `POST` (multipart) -> `202` + job: §9's historical import. */
    imports: "/student-attendance-imports",
  },
  /** `GET` runs a report (rows inline, or `202` + job when large); `POST` exports it as a job. */
  attendanceReports: {
    summary: "/reports/attendance-summary",
  },
  /** `ExamReportView`: `GET` runs a report inline (a `202` + job past 1000 rows), `POST` exports. */
  examReports: {
    summary: "/reports/exam-summary",
  },
  /** `apps/api/apps/attendance/urls.py`: the register is routed before the router; check-out
   * is a colon-action on the row. */
  staffAttendance: {
    list: "/staff-attendance",
    register: "/staff-attendance/register",
    checkOut: (id: string) => `/staff-attendance/${id}:check-out`,
  },
  /** `apps/api/apps/attendance/urls.py`: approve and reject are colon-actions on the row. */
  attendanceCorrections: {
    list: "/attendance-corrections",
    action: (id: string, action: "approve" | "reject") => `/attendance-corrections/${id}:${action}`,
  },
  /** `apps/api/apps/attendance/urls.py`: approve and reject are colon-actions on the row. */
  leaveRequests: {
    list: "/leave-requests",
    /** `:cancel` is the requester's withdrawal, a colon-action like approve and reject. */
    cancel: (id: string) => `/leave-requests/${id}:cancel`,
    action: (id: string, action: "approve" | "reject") => `/leave-requests/${id}:${action}`,
  },
  /** `GET /leave-types`: the read-only catalogue, keyed `attendance.leave-request.view`. */
  leaveTypes: {
    list: "/leave-types",
  },
  /** `apps/api/apps/examinations`: the scales, their bands and the colon-action. */
  gradingScales: {
    list: "/grading-scales",
    detail: (id: string) => `/grading-scales/${id}`,
    /** Colon-action, not a nested path: the registered route is `/grading-scales/{id}:set-default`. */
    setDefault: (id: string) => `/grading-scales/${id}:set-default`,
    bands: (scaleId: string) => `/grading-scales/${scaleId}/grade-bands`,
    band: (scaleId: string, bandId: string) => `/grading-scales/${scaleId}/grade-bands/${bandId}`,
  },
  /** `/question-banks` (`exams.question-bank.*`), its nested questions and two colon-actions. */
  questionBanks: {
    list: "/question-banks",
    detail: (id: string) => `/question-banks/${id}`,
    /** Colon-action: `202` + a job rendering the paper PDF, keyed `exams.question-bank.update`. */
    assemblePaper: (id: string) => `/question-banks/${id}:assemble-paper`,
    questions: (bankId: string) => `/question-banks/${bankId}/questions`,
    question: (bankId: string, id: string) => `/question-banks/${bankId}/questions/${id}`,
    /** Colon-action keyed `exams.question.approve`: an AI draft into the bank's usable pool. */
    approveQuestion: (bankId: string, id: string) =>
      `/question-banks/${bankId}/questions/${id}:approve`,
  },
  /** `/exams`: the exam, keyed `exams.exam.*`. */
  exams: {
    list: "/exams",
    detail: (id: string) => `/exams/${id}`,
    /** The exam's clash list, keyed `exams.schedule.view`. */
    scheduleConflicts: (id: string) => `/exams/${id}/schedule-conflicts`,
    /** Colon-action, not a nested path: the registered route is `/exams/{id}:publish-schedule`. */
    publishSchedule: (id: string) => `/exams/${id}:publish-schedule`,
    /** Colon-action: `202` + a render job, keyed `exams.admit-card.issue`. */
    issueAdmitCards: (id: string) => `/exams/${id}:issue-admit-cards`,
    /** Per (exam-subject, section) entry counts, keyed `exams.marks.view`. */
    marksProgress: (id: string) => `/exams/${id}/marks-progress`,
    /** Colon-actions on the exam's results: processing is `202` + a job (`exams.result.create`);
     * approve and send back take `exams.result.approve`, publish `exams.result.publish`. */
    processResults: (id: string) => `/exams/${id}:process-results`,
    approveResults: (id: string) => `/exams/${id}:approve-results`,
    sendResultsBack: (id: string) => `/exams/${id}:send-results-back`,
    publishResults: (id: string) => `/exams/${id}:publish-results`,
    /** Colon-actions on the exam's report cards: generating is `202` + a job
     * (`exams.report-card.create`), publishing takes `exams.report-card.publish`. */
    generateReportCards: (id: string) => `/exams/${id}:generate-report-cards`,
    publishReportCards: (id: string) => `/exams/${id}:publish-report-cards`,
  },
  /** `/results`: an exam's processed results, keyed `exams.result.*`. */
  results: {
    list: "/results",
    /** Colon-action, keyed `exams.result.publish`; the body carries the reason. */
    withhold: (id: string) => `/results/${id}:withhold`,
  },
  /** `/report-cards`: an exam's cards, keyed `exams.report-card.*`; the PATCH writes remarks only. */
  reportCards: {
    list: "/report-cards",
    detail: (id: string) => `/report-cards/${id}`,
    /** Colon-action, keyed `exams.report-card.view`: a signed link to the card's own PDF. */
    download: (id: string) => `/report-cards/${id}:download`,
  },
  /** `/admit-cards`: an exam's issued cards, keyed `exams.admit-card.*`. */
  admitCards: {
    list: "/admit-cards",
    /** Colon-action, keyed `exams.admit-card.issue`; the body carries the reason. */
    revoke: (id: string) => `/admit-cards/${id}:revoke`,
    /** Colon-action, keyed `exams.admit-card.view`: a signed link to the card's own PDF. */
    download: (id: string) => `/admit-cards/${id}:download`,
  },
  /** `/marks`: one section's grid (`exams.marks.view`), its whole-grid save (`exams.marks.create`)
   * and the sheet import (`exams.marks.import`, multipart, `202` + job). */
  marks: {
    /** The entered marks, filtered (`exam_id`, `student_id`): a student's subject marks. */
    list: "/marks",
    grid: "/marks/grid",
    bulkEntry: "/marks:bulk-entry",
    imports: "/marks-imports",
  },
  /** `/exam-schedules`: an exam's sittings, keyed `exams.schedule.*`. */
  examSchedules: {
    list: "/exam-schedules",
    detail: (id: string) => `/exam-schedules/${id}`,
  },
  /** `/exam-subjects`: one exam's per-class marks structure; writes are keyed `exams.exam.update`. */
  examSubjects: {
    list: "/exam-subjects",
    detail: (id: string) => `/exam-subjects/${id}`,
    /** Colon-actions keyed `exams.marks.lock`; the unlock is audited. */
    lockMarks: (id: string) => `/exam-subjects/${id}:lock-marks`,
    unlockMarks: (id: string) => `/exam-subjects/${id}:unlock-marks`,
  },
  /** `apps/api/apps/timetable/rooms/urls.py`. */
  rooms: {
    list: "/rooms",
    detail: (id: string) => `/rooms/${id}`,
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
    /** `POST /student-imports` (multipart)/`POST /student-exports` -> `202` + job
     * (`apps/api/apps/student_management/urls.py`) — poll it via `jobs.detail` below. */
    imports: "/student-imports",
    exports: "/student-exports",
  },
  /** A colon-action on the collection, not a nested path — the real registered route is
   * `POST /id-cards:generate` (`apps/api/apps/student_management/urls.py`) -> `202` + job
   * whose result is one merged PDF. `POST` only. */
  idCards: {
    generate: "/id-cards:generate",
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
  /** `GET/POST /student-transfers` plus the `:approve`/`:reject`/`:complete`
   * colon-actions — a top-level resource from the start, unlike `studentDocuments`
   * above (whose creation is nested under `students.documents`). */
  studentTransfers: {
    list: "/student-transfers",
    create: "/student-transfers",
    approve: (id: string) => `/student-transfers/${id}:approve`,
    reject: (id: string) => `/student-transfers/${id}:reject`,
    complete: (id: string) => `/student-transfers/${id}:complete`,
  },
  /** `/student-promotions` (`apps/api/apps/academics/promotions/urls.py`). Every `{id}` is a
   * batch id; `POST` on `list` creates a batch. The colon-actions are the real registered
   * routes, and `execute` answers `202` + a job, the rest `200` + `{updated}`. */
  promotions: {
    list: "/student-promotions",
    detail: (batchId: string) => `/student-promotions/${batchId}`,
    /** A decision is addressed by batch and student, not by its own row id. */
    decision: (batchId: string, studentId: string) =>
      `/student-promotions/${batchId}/decisions/${studentId}`,
    submit: (id: string) => `/student-promotions/${id}:submit`,
    approve: (id: string) => `/student-promotions/${id}:approve`,
    reject: (id: string) => `/student-promotions/${id}:reject`,
    execute: (id: string) => `/student-promotions/${id}:execute`,
    revert: (id: string) => `/student-promotions/${id}:revert`,
  },
  /** `/message-threads` (`apps/api/apps/communication/threads/urls.py`): the caller's inbox. `messages`
   * is nested under a thread; `markRead`/`close`/`reopen` are colon-actions on one thread. */
  messageThreads: {
    list: "/message-threads",
    detail: (id: string) => `/message-threads/${id}`,
    messages: (id: string) => `/message-threads/${id}/messages`,
    markRead: (id: string) => `/message-threads/${id}:mark-read`,
    close: (id: string) => `/message-threads/${id}:close`,
    reopen: (id: string) => `/message-threads/${id}:reopen`,
    recipients: "/message-threads/recipients",
    attachmentDownload: (id: string, fileId: string) =>
      `/message-threads/${id}/attachments/${fileId}:download`,
  },
  /** `/message-thread-oversight`: every alive thread in the tenant, read-only and audited. */
  threadOversight: {
    list: "/message-thread-oversight",
    detail: (id: string) => `/message-thread-oversight/${id}`,
    messages: (id: string) => `/message-thread-oversight/${id}/messages`,
    attachmentDownload: (id: string, fileId: string) =>
      `/message-thread-oversight/${id}/attachments/${fileId}:download`,
  },
  /** `GET /broadcasts:scope`, `POST /broadcasts:preview` and `POST /broadcasts:emergency`
   * (202 + job). */
  broadcasts: {
    scope: "/broadcasts:scope",
    preview: "/broadcasts:preview",
    emergency: "/broadcasts:emergency",
  },
  /** `GET /parent-portal/dashboard`: the guardian's or student's home summary. */
  parentPortal: {
    dashboard: "/parent-portal/dashboard",
  },
  /** `/notifications`: the caller's own inbox; the actions are colon-actions
   * (`apps/api/core/notifications/urls.py`). */
  notifications: {
    list: "/notifications",
    markRead: (id: string) => `/notifications/${id}:mark-read`,
    markAllRead: "/notifications:mark-all-read",
    unreadCount: "/notifications:unread-count",
  },
  /** `/notification-preferences`: the caller's category x channel matrix (`GET`, `PATCH`). */
  notificationPreferences: {
    list: "/notification-preferences",
  },
  /** `/notices`: a guardian reads and acknowledges; staff manage (not called here). */
  notices: {
    list: "/notices",
    detail: (id: string) => `/notices/${id}`,
    acknowledge: (id: string) => `/notices/${id}:acknowledge`,
  },
  /** `/fee-invoices`: read-only for a guardian (published, non-draft rows only); staff write with `fees.invoice.create|update`. */
  feeInvoices: {
    list: "/fee-invoices",
    detail: (id: string) => `/fee-invoices/${id}`,
    /** Colon-actions, not nested paths: the registered routes are `/fee-invoices:generate` and `/fee-invoices/{id}:cancel`. */
    generate: "/fee-invoices:generate",
    cancel: (id: string) => `/fee-invoices/${id}:cancel`,
  },
  /** `/discounts`: read with `fees.discount.view`, written with `fees.discount.create`; `:revoke` needs `fees.discount.waive`. No DELETE route exists. */
  discounts: {
    list: "/discounts",
    detail: (id: string) => `/discounts/${id}`,
    /** Colon-action, not a nested path: the registered route is `/discounts/{id}:revoke`. */
    revoke: (id: string) => `/discounts/${id}:revoke`,
  },
  /** `/scholarships`: read with `fees.discount.view`, written with `fees.scholarship.create`; the lifecycle moves through PATCH `status`. No DELETE route exists. */
  scholarships: {
    list: "/scholarships",
    detail: (id: string) => `/scholarships/${id}`,
  },
  /** `/fines`: read with `fees.fine.view`, written with `fees.fine.create`; `:waive` needs `fees.fine.waive`. No DELETE route exists. */
  fines: {
    list: "/fines",
    detail: (id: string) => `/fines/${id}`,
    waive: (id: string) => `/fines/${id}:waive`,
  },
  /** `/payments`: read with `fees.payment.view` (also the key for receipts and vouchers). */
  payments: {
    list: "/payments",
    /** Colon-action, not a nested path: the registered route is `/payments:record` (`fees.payment.collect`). */
    record: "/payments:record",
  },
  /** `/vouchers`: a guardian reads the slips of their own child's invoices; `download` streams
   * a PDF (`?format=pdf|thermal`). */
  vouchers: {
    list: "/vouchers",
    download: (id: string) => `/vouchers/${id}/download`,
    /** Nested under the invoice (`fees.payment.collect`): the registered route is `/fee-invoices/{id}/vouchers`. */
    issue: (invoiceId: string) => `/fee-invoices/${invoiceId}/vouchers`,
    /** Colon-action, not a nested path: the registered route is `/vouchers/{id}:void` (`fees.payment.collect`). */
    void: (id: string) => `/vouchers/${id}:void`,
  },
  /** `/refunds`: read with `fees.payment.view`. Every transition is a colon-action: `:create` needs
   * `fees.payment.refund` (a collection action, not a plain POST), `:approve`, `:reject` and
   * `:process` need `fees.refund.approve`. */
  refunds: {
    list: "/refunds",
    create: "/refunds:create",
    approve: (id: string) => `/refunds/${id}:approve`,
    reject: (id: string) => `/refunds/${id}:reject`,
    process: (id: string) => `/refunds/${id}:process`,
  },
  /** `/voucher-collection-imports`: read with `fees.payment.view`; the multipart POST (202 + job)
   * needs `fees.payment.collect`. Staff-only. */
  settlementImports: {
    list: "/voucher-collection-imports",
    detail: (id: string) => `/voucher-collection-imports/${id}`,
  },
  /** `/receipts`; `download` streams a PDF (`?format=pdf|thermal`). */
  receipts: {
    list: "/receipts",
    download: (id: string) => `/receipts/${id}/download`,
  },
  /** `/ledger-accounts`: the chart of accounts. Read with `fees.ledger.view`, written with `fees.ledger.create`. */
  ledgerAccounts: {
    list: "/ledger-accounts",
    detail: (id: string) => `/ledger-accounts/${id}`,
  },
  /** `/fee-heads`: read with `fees.fee-structure.view`, written with `fees.fee-structure.create|update|delete`. */
  feeHeads: {
    list: "/fee-heads",
    detail: (id: string) => `/fee-heads/${id}`,
  },
  /** `/fee-structures` (`fees.fee-structure.view|create|update|delete`) and its lifecycle colon-actions, which need `.update`. */
  feeStructures: {
    list: "/fee-structures",
    detail: (id: string) => `/fee-structures/${id}`,
    /** Colon-action, not a nested path: the registered route is `/fee-structures/{id}:activate`. */
    activate: (id: string) => `/fee-structures/${id}:activate`,
    archive: (id: string) => `/fee-structures/${id}:archive`,
  },
  /** `/fee-schedules` (`fees.fee-structure.*`, the same keys as the structure): a structure's lines. */
  feeSchedules: {
    list: "/fee-schedules",
    detail: (id: string) => `/fee-schedules/${id}`,
  },
} as const;
