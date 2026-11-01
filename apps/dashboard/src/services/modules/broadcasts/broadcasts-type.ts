import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type BroadcastPreview = ApiSchemas["BroadcastPreview"];
export type BroadcastRequest = ApiSchemas["BroadcastRequest"];
export type BroadcastSend = ApiSchemas["BroadcastSend"];
export type BroadcastAudienceFilter = ApiSchemas["BroadcastAudienceFilter"];
export type BroadcastAudienceType = ApiSchemas["CommunicationAudienceTypeEnum"];
export type BroadcastQueued = ApiSchemas["BroadcastQueued"];
/** Where the caller may broadcast: `campus_ids` is `null` when unrestricted. */
export type BroadcastScope = ApiSchemas["BroadcastScope"];
