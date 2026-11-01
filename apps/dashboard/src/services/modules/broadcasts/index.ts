import { preview, send } from "./broadcasts-service";

export const BroadcastsService = { preview, send };

export type {
  BroadcastAudienceFilter,
  BroadcastAudienceType,
  BroadcastPreview,
  BroadcastQueued,
  BroadcastRequest,
  BroadcastSend,
} from "./broadcasts-type";
