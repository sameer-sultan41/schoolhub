import type { Page } from "@schoolhub/types";

import type { RoomRecord } from "@/services";
import { CAMPUS_ID } from "@/test-fixtures/academics";

// UUID-shaped: the URL and the form drop an id that isn't one.
export const ROOM_ID = "9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a";

/** Room R-101, a 40-seat classroom on the main campus; override what a test needs. */
export function roomRecord(overrides: Partial<RoomRecord> = {}): RoomRecord {
  return {
    id: ROOM_ID,
    campus_id: CAMPUS_ID,
    campus_name: "Main Campus",
    name: "Room 101",
    code: "R-101",
    room_type: "classroom",
    capacity: 40,
    building: "Main block",
    floor: "1",
    is_active: true,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

export function roomPage(items: RoomRecord[]): Page<RoomRecord> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}
