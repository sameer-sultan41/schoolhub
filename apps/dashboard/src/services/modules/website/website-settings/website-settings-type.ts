import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). Before the first save, `GET` answers an unsaved
 * default with `exists: false`. */
export type WebsiteSettingsRecord = ApiSchemas["WebsiteSettings"];
export type SocialLink = ApiSchemas["SocialLink"];

/** The writable fields of `PATCH /website-settings` (the read-only ones dropped). */
export type WebsiteSettingsInput = Omit<
  ApiSchemas["PatchedWebsiteSettings"],
  "exists" | "theme_code" | "theme_version" | "updated_at"
>;
