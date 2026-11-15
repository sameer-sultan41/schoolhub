import type { ApiSchemas } from "@schoolhub/api-client";

import type { WebsiteContentQuery } from "@/services/shared/website-content";

/** The generated wire shapes (ADR-0017). `body` is a rich-text block document. */
export type NewsPostRecord = ApiSchemas["NewsPostList"];
export type NewsPostDetail = ApiSchemas["NewsPostDetail"];
export type NewsPostInput = ApiSchemas["NewsPostWrite"];
export type NewsPostUpdateInput = ApiSchemas["PatchedNewsPostWrite"];

export type NewsPostQuery = WebsiteContentQuery;
