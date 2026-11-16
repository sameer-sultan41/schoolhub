import type { ApiSchemas } from "@schoolhub/api-client";

import type { WebsiteContentQuery } from "@/services/shared/website-content";

/** The generated wire shapes (ADR-0017). `description` is a rich-text block document. */
export type SchoolEventRecord = ApiSchemas["SchoolEventList"];
export type SchoolEventDetail = ApiSchemas["SchoolEventDetail"];
export type SchoolEventInput = ApiSchemas["SchoolEventWrite"];
export type SchoolEventUpdateInput = ApiSchemas["PatchedSchoolEventWrite"];

/** `startsAfter`/`startsBefore` are ISO date-times bounding `starts_at`. */
export interface SchoolEventQuery extends WebsiteContentQuery {
  startsAfter?: string;
  startsBefore?: string;
}
