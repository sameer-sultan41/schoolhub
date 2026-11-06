import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). A scale carries its bands, read-only. */
export type GradingScaleRecord = ApiSchemas["GradingScale"];
export type GradeBandRecord = ApiSchemas["GradeBand"];
export type GradingScaleType = ApiSchemas["GradingScaleTypeEnum"];

export interface GradingScalePageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  scaleType?: GradingScaleType;
}

/** A null `gpaMax` or `description` clears it. `isDefault` is not here: it moves only
 * through `setDefault`. */
export interface GradingScaleInput {
  name: string;
  scaleType: GradingScaleType;
  gpaMax: string | null;
  description: string | null;
}

/** Percentages and the grade point are decimal strings, as the API sends them. */
export interface GradeBandInput {
  label: string;
  minPercent: string;
  maxPercent: string;
  gradePoint: string | null;
  isPassing: boolean;
  remark: string | null;
  sortOrder: number;
}

/** One finding of the advisory coverage check; the labels name the bands involved. */
export type CoverageIssue =
  | { kind: "empty" }
  | { kind: "start"; at: string }
  | { kind: "end"; at: string }
  | { kind: "gap"; lower: string; upper: string; from: string; to: string }
  | { kind: "overlap"; lower: string; upper: string; from: string; to: string };
