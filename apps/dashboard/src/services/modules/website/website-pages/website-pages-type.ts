import type { ApiSchemas } from "@schoolhub/api-client";

import type { WebsiteContentQuery } from "@/services/shared/website-content";

/** The generated wire shapes (ADR-0017). */
export type WebsitePageRecord = ApiSchemas["WebsitePageList"];
export type WebsitePageDetail = ApiSchemas["WebsitePageDetail"];
export type WebsitePageType = ApiSchemas["WebsitePageTypeEnum"];
export type PageSectionRecord = ApiSchemas["PageSection"];
export type PageSectionInput = ApiSchemas["SectionInput"];
export type SectionType = ApiSchemas["SectionTypeEnum"];
export type WebsitePageCreateInput = ApiSchemas["WebsitePageWrite"];
export type WebsitePageUpdateInput = ApiSchemas["PatchedWebsitePageUpdate"];
export type PagePreview = ApiSchemas["PagePreview"];

export interface WebsitePageQuery extends WebsiteContentQuery {
  pageType?: WebsitePageType;
}
