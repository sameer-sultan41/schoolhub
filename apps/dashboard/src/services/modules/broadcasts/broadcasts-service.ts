import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import type { BroadcastPreview, BroadcastRequest, BroadcastSend } from "./broadcasts-type";

/**
 * The broadcasts domain's API calls (`/broadcasts:preview`, `/broadcasts:emergency`). Reached
 * through `Services.broadcasts.*`.
 */

/** What a send would do right now: the count, the digest and the channels a send must repeat. */
export async function preview(body: BroadcastRequest): Promise<BroadcastPreview> {
  const { data } = await apiClient.post<BroadcastPreview>(endpoints.broadcasts.preview, body);
  return data;
}

/** Sends an emergency broadcast: `202` + a job to poll. The same key with the same body replays
 * the first job; a corrected message needs a new key. A 409 means the audience changed since
 * the preview. */
export async function send(body: BroadcastSend, idempotencyKey: string): Promise<JobAccepted> {
  const { data } = await apiClient.post<JobAccepted>(endpoints.broadcasts.emergency, body, {
    idempotencyKey,
  });
  return data;
}
