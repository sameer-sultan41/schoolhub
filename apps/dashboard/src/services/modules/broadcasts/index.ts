import { fetchScope, preview, send } from "./broadcasts-service";

export const BroadcastsService = { fetchScope, preview, send };

export type {
  BroadcastAudienceFilter,
  BroadcastAudienceType,
  BroadcastPreview,
  BroadcastQueued,
  BroadcastRequest,
  BroadcastScope,
  BroadcastSend,
} from "./broadcasts-type";
