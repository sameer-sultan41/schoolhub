import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes — see `docs/decisions/0017-generated-wire-types-for-new-domains.md`. */
export type PortalDashboard = ApiSchemas["PortalDashboard"];
export type PortalChild = ApiSchemas["PortalChild"];
export type PortalStudent = ApiSchemas["PortalStudent"];
export type PortalModules = ApiSchemas["PortalModules"];
export type PortalModuleKey = keyof PortalModules;
