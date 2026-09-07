import { pagedList } from "../envelope";
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
 * nothing under `apps/api` routes a reporting app — and the home screen has been rebuilt
 * on endpoints that ship, so the stub for it is gone with the component that fetched it.
 *
 * What is left is what the home screen asks for that `SCHOOL_ADMIN_PERMISSIONS`
 * (src/data/factories.ts) actually lets it ask for: the two head counts. Every other
 * panel on that screen is gated behind a key the mocked user deliberately does not hold
 * — `timetable.timetable.view`, `academics.teacher-allocation.view`,
 * `school.section.view` — so it renders nothing and fetches nothing. If that permission
 * list grows, the `mockApi` fixture's teardown will name the newly-unstubbed path, which
 * is the mechanism working: add it here rather than widening a catch-all.
 *
 * The counts come from `meta.pagination.total_count`. Both lists page by number now
 * (`PageNumberPagination`, api-architecture.md §2.4), so the total is always present
 * rather than the opt-in it was under a counted cursor. The row itself is a stub: the
 * tile reads only the total, so modelling a whole `Student` here would be inventing a
 * contract this screen does not consume.
 *
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
  };
}
