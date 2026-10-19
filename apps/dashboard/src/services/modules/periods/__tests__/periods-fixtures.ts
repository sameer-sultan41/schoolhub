import type { Page } from "@schoolhub/types";

import type { PeriodRecord } from "@/services";
import { CAMPUS_ID } from "@/test-fixtures/academics";

// UUID-shaped: the URL and the form drop an id that isn't one.
export const PERIOD_ID = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";

/** Period 1, 08:00–08:45, at every campus on the working days; override what a test needs. */
export function periodRecord(overrides: Partial<PeriodRecord> = {}): PeriodRecord {
  return {
    id: PERIOD_ID,
    campus_id: null,
    campus_name: null,
    name: "Period 1",
    sequence: 1,
    start_time: "08:00:00",
    end_time: "08:45:00",
    is_break: false,
    weekdays: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

/** A campus period, for a test that needs the campus column filled. */
export const CAMPUS_PERIOD = { campus_id: CAMPUS_ID, campus_name: "Main Campus" };

export function periodPage(items: PeriodRecord[]): Page<PeriodRecord> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}
