import type { Page } from "@schoolhub/types";

import type { GradeBandRecord, GradingScaleRecord } from "@/services";

// UUID-shaped: the URL and the form drop an id that isn't one.
export const SCALE_ID = "3b1c5d7e-9f0a-4b2c-8d4e-6f8a0b2c4d6e";
export const OTHER_SCALE_ID = "4c2d6e8f-0a1b-4c3d-9e5f-7a9b1c3d5e7f";
export const BAND_ID = "5d3e7f9a-1b2c-4d4e-8f6a-8b0c2d4e6f80";

/** A band with a fixed id; override what a test needs. */
export function bandRecord(overrides: Partial<GradeBandRecord> = {}): GradeBandRecord {
  return {
    id: BAND_ID,
    grading_scale_id: SCALE_ID,
    label: "A",
    min_percent: "80.00",
    max_percent: "100.00",
    grade_point: null,
    is_passing: true,
    remark: null,
    sort_order: 0,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

/** The standard school scale: Letter grades, the default, with two bands. */
export function scaleRecord(overrides: Partial<GradingScaleRecord> = {}): GradingScaleRecord {
  return {
    id: SCALE_ID,
    name: "Standard letters",
    scale_type: "letter",
    gpa_max: null,
    is_default: true,
    description: null,
    bands: [bandRecord(), bandRecord({ id: "6e4f8a0b-2c3d-4e5f-9a7b-9c1d3e5f7a91", label: "B" })],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

export function scalePage(items: GradingScaleRecord[]): Page<GradingScaleRecord> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}
