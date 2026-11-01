import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import type {
  BroadcastPreview,
  BroadcastRequest,
} from "@/services/modules/broadcasts/broadcasts-type";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

/** Shared setup for the Emergency broadcast tests; each file keeps its own `jest.mock` call. */

export const fetchScope = mocked(Services.broadcasts.fetchScope);
export const preview = mocked(Services.broadcasts.preview);
export const send = mocked(Services.broadcasts.send);
export const fetchCampuses = mocked(Services.dashboard.fetchCampuses);
export const fetchClasses = mocked(Services.schoolOrganization.fetchClasses);
export const fetchSections = mocked(Services.schoolOrganization.fetchSections);
export const fetchJob = mocked(Services.jobs.fetchJob);

export const CLASS_ID = "11111111-1111-4111-8111-111111111111";
export const JOB_ID = "22222222-2222-4222-8222-222222222222";

export const NORTH = { id: "33333333-3333-4333-8333-333333333333", name: "North campus" };
export const SOUTH = { id: "44444444-4444-4444-8444-444444444444", name: "South campus" };
export const EAST = { id: "55555555-5555-4555-8555-555555555555", name: "East campus" };
/** A soft-deleted campus a role's scope still names: no campus list carries it. */
export const GONE_CAMPUS_ID = "66666666-6666-4666-8666-666666666666";

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
    job_type: "communication.emergency-broadcast",
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
