import { ok, pagedList, paginated } from "../envelope";
import type { MockModule } from "../router";

export interface DashboardHomeOptions {
  /** `meta.pagination.total_count` for `/students`. Omit for the default head count. */
  studentTotal?: number;
  /** Same, for `/staff`. */
  staffTotal?: number;
}

/**
 * The reads `/dashboard` makes on top of auth and tenant chrome.
 *
 * **This used to stub `/reports/dashboard-summary`.** That endpoint never existed —
 * nothing under `apps/api` routes a reporting app.
 *
 * On `main` the home screen is permission-gated (`SCHOOL_ADMIN_PERMISSIONS`,
 * src/data/factories.ts), so most of its panels render nothing and fetch nothing for the
 * mocked user, and this module only needed to stub the two head counts. **This branch's
 * `/dashboard` is different**: it's the vendor Metronic demo1 preview repurposed onto
 * real data (apps/dashboard/src/app/(app)/shell/dashboard/*.tsx), there is no permission
 * system here yet, and every widget fetches unconditionally — so this module stubs every
 * endpoint those widgets call, not just the two head counts. If the unstubbed-request
 * check names a new path, that's this file falling behind a new widget — add it here
 * rather than widening a catch-all.
 *
 * The two head counts come from `meta.pagination.total_count` (`PageNumberPagination`,
 * api-architecture.md §2.4). The row itself is a stub in every case: each widget reads
 * only a count or a total, so modelling full `Student`/`Class`/etc. records here would be
 * inventing a contract this screen does not consume.
 */
export function dashboardHomeModule(options: DashboardHomeOptions = {}): MockModule {
  const { studentTotal = 482, staffTotal = 37 } = options;

  return (api) => {
    api.get("/students", () =>
      pagedList([{ id: "student-e2e" }], { page_size: 1, total_count: studentTotal }),
    );
    api.get("/staff", () =>
      pagedList([{ id: "staff-e2e" }], { page_size: 1, total_count: staffTotal }),
    );
    // Bounded reference lists the ChannelStats/Highlights widgets count in full.
    api.get("/classes", () => pagedList([{ id: "class-e2e" }]));
    api.get("/sections", () => pagedList([{ id: "section-e2e" }]));
    api.get("/subjects", () => pagedList([{ id: "subject-e2e" }]));
    api.get("/campuses", () => pagedList([{ id: "campus-e2e" }]));
    // Cursor-paginated, unlike the lists above — matches the real endpoint's own
    // envelope, confirmed directly against a running API.
    api.get("/academic-sessions", () =>
      paginated([{ id: "session-e2e", name: "2026-27", status: "active", is_current: true }]),
    );
    // EarningsChart's teacher-load aggregate for the resolved session.
    api.get("/teacher-subject-allocations/load-summary", () => ok([]));
    // TeamMeeting's timetable lookup. No `pagination` meta on the real endpoint — the
    // session/date context lives alongside `data` instead.
    api.get("/timetables/my", (request) =>
      ok([], {
        meta: {
          academic_session_id: "session-e2e",
          date: request.searchParams.get("date"),
          audience: "staff",
        },
      }),
    );
  };
}
