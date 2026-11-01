import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import type {
  BroadcastPreview,
  BroadcastRequest,
} from "@/services/modules/broadcasts/broadcasts-type";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

/** Shared setup for the Emergency broadcast tests; each file keeps its own `jest.mock` call. */

export const preview = mocked(Services.broadcasts.preview);
export const send = mocked(Services.broadcasts.send);
export const fetchCampuses = mocked(Services.dashboard.fetchCampuses);
export const fetchClasses = mocked(Services.schoolOrganization.fetchClasses);
export const fetchSections = mocked(Services.schoolOrganization.fetchSections);
export const fetchJob = mocked(Services.jobs.fetchJob);

export const CLASS_ID = "11111111-1111-4111-8111-111111111111";
export const JOB_ID = "22222222-2222-4222-8222-222222222222";

export const REQUEST: BroadcastRequest = { audience_type: "staff", message: "School is closed." };

export function previewRecord(overrides: Partial<BroadcastPreview> = {}): BroadcastPreview {
  return {
    recipient_count: 3,
    audience_digest: "digest-1",
    channels: ["in_app"],
    unavailable_channels: ["sms"],
    ...overrides,
  };
}

export function jobRecord(overrides: Partial<BackgroundJobRecord> = {}): BackgroundJobRecord {
  return {
    id: JOB_ID,
    job_type: "communication.emergency_broadcast",
    status: "succeeded",
    progress: 100,
    result: { recipient_count: 3, notification_count: 3 },
    error: null,
    ...overrides,
  };
}

/** The idempotency key the nth `send` call used. */
export function keyOfCall(index: number): unknown {
  return send.mock.calls[index]?.[1];
}
