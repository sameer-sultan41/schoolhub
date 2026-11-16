import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). A target never saved answers `exists: false`. */
export type SeoSettingRecord = ApiSchemas["SeoSetting"];
export type SeoTargetType = ApiSchemas["SeoTargetTypeEnum"];

/** The writable fields of `PATCH /seo-settings` (the read-only ones dropped). */
export type SeoSettingInput = Omit<
  ApiSchemas["PatchedSeoSetting"],
  "exists" | "target_type" | "target_id" | "structured_data" | "updated_at"
>;

/** Which row: the site's own (`site`, no id) or one record's. */
export interface SeoTarget {
  targetType: SeoTargetType;
  targetId?: string;
}
