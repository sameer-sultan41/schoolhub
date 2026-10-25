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
 * `FORGOT_PASSWORD` and `RESET_PASSWORD` have no page yet — `proxy.ts` already carves
 * them out as public paths in anticipation of the auth module growing those two screens,
 * so their constants live here now rather than being invented twice later.
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
  ATTENDANCE_SETTINGS: "/attendance/settings",
  LOGIN: "/login",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
} as const;

/** One promotion batch's review page, under the promotions list. */
export const promotionBatchPath = (batchId: string) => `${Paths.ACADEMICS_PROMOTIONS}/${batchId}`;
