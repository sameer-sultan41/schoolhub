/**
 * Every dashboard page path, in one place — grouped the same way `lib/regex.ts` groups
 * this app's regex patterns, so the two "one named object, not scattered literals"
 * modules read the same way.
 *
 * Named `Paths`, not `Routes`: these are plain string constants for `<Link href>` and
 * `router.push`/`.replace` targets, not a Next.js routing construct — there's no relation
 * to a `route.ts` handler or the App Router's own "routes" (the `app/` file tree already
 * owns that word).
 *
 * Before this file, each real path (`/dashboard`, `/staff`, …) was a string literal
 * repeated independently in `proxy.ts`'s public-path allowlist, `menu-config.ts`'s nav
 * entries, and every `<Link>`/redirect that pointed at it — five and six copies of the
 * same path with no way to know they were all supposed to agree (ADR-0014). A typo or a
 * renamed path in only one of them fails silently: nothing type-checks a path string
 * against Next's file-system router, so every call site imports this object instead of
 * writing its own copy.
 *
 * `FORGOT_PASSWORD`, `RESET_PASSWORD` and `ACCEPT_INVITE` are the unauthenticated
 * account pages (ADR-0033); the last two open from an emailed link that carries its token
 * in the URL fragment.
 */
export const Paths = {
  DASHBOARD: "/dashboard",
  STUDENTS: "/students",
  STAFF: "/staff",
  ACADEMICS: "/academics",
  ACADEMICS_CURRICULUM: "/academics/curriculum",
  ACADEMICS_ALLOCATIONS: "/academics/allocations",
  ACADEMICS_PROMOTIONS: "/academics/promotions",
  TIMETABLE: "/timetable",
  TIMETABLE_GRID: "/timetable/grid",
  TIMETABLE_PERIODS: "/timetable/periods",
  TIMETABLE_ROOMS: "/timetable/rooms",
  TIMETABLE_SUBSTITUTIONS: "/timetable/substitutions",
  TIMETABLE_MY: "/timetable/my",
  ATTENDANCE: "/attendance",
  ATTENDANCE_REGISTER: "/attendance/register",
  ATTENDANCE_RECORDS: "/attendance/records",
  ATTENDANCE_CORRECTIONS: "/attendance/corrections",
  ATTENDANCE_LEAVE: "/attendance/leave",
  ATTENDANCE_STAFF: "/attendance/staff",
  ATTENDANCE_REPORTS: "/attendance/reports",
  ATTENDANCE_SETTINGS: "/attendance/settings",
  COMMUNICATION: "/communication",
  COMMUNICATION_MESSAGES: "/communication/messages",
  COMMUNICATION_OVERSIGHT: "/communication/oversight",
  COMMUNICATION_BROADCAST: "/communication/broadcast",
  /** The parent/student portal (`app/(portal)/portal`). A child is the `[studentId]` segment. */
  PORTAL: "/portal",
  PORTAL_CHILD: (studentId: string) => `/portal/${studentId}`,
  PORTAL_ATTENDANCE: (studentId: string) => `/portal/${studentId}/attendance`,
  PORTAL_LEAVE: (studentId: string) => `/portal/${studentId}/leave`,
  PORTAL_FEES: (studentId: string) => `/portal/${studentId}/fees`,
  PORTAL_INVOICE: (studentId: string, invoiceId: string) =>
    `/portal/${studentId}/fees/${invoiceId}`,
  PORTAL_RESULTS: (studentId: string) => `/portal/${studentId}/results`,
  PORTAL_TIMETABLE: (studentId: string) => `/portal/${studentId}/timetable`,
  PORTAL_MESSAGES: "/portal/messages",
  PORTAL_NOTICES: "/portal/notices",
  PORTAL_NOTICE: (noticeId: string) => `/portal/notices/${noticeId}`,
  PORTAL_NOTIFICATIONS: "/portal/notifications",
  PORTAL_SETTINGS: "/portal/settings",
  EXAMS: "/exams",
  EXAMS_GRADING_SCALES: "/exams/grading-scales",
  EXAMS_REPORTS: "/exams/reports",
  EXAMS_QUESTION_BANKS: "/exams/question-banks",
  LOGIN: "/login",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  ACCEPT_INVITE: "/accept-invite",
} as const;

/** One promotion batch's review page, under the promotions list. */
export const promotionBatchPath = (batchId: string) => `${Paths.ACADEMICS_PROMOTIONS}/${batchId}`;

/** One exam's page, under the exams list. */
export const examPath = (examId: string) => `${Paths.EXAMS}/${examId}`;

/** One question bank's page, under the banks list. */
export const questionBankPath = (bankId: string) => `${Paths.EXAMS_QUESTION_BANKS}/${bankId}`;
