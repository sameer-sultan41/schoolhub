import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017): what `GET`/`PATCH /school-settings` return, and the
 * `PATCH` body. */
export type SchoolSettingsRecord = ApiSchemas["SchoolSettings"];
export type SchoolSettingsUpdate = ApiSchemas["PatchedSchoolSettingsUpdate"];
