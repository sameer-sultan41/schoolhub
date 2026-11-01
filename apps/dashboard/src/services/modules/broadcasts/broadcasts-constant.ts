import type { BroadcastAudienceType } from "./broadcasts-type";

/** The broadcasts module's constants. */

/** A broadcast message's longest length (the server's `BROADCAST_MESSAGE_MAX_LENGTH`; the
 * generated schema carries no `maxLength` for it). */
export const BROADCAST_MESSAGE_MAX_LENGTH = 1000;

/** The audiences the screen offers. The schema enum also has `custom`, which has no picker yet. */
export const BROADCAST_AUDIENCE_TYPES = [
  "all",
  "staff",
  "students",
  "guardians",
  "class",
  "section",
] as const satisfies readonly BroadcastAudienceType[];

/** The query-key module a broadcast preview is cached under. */
export const BROADCASTS_QUERY_MODULE = "broadcasts";

/** The job-polling namespace a broadcast job's watch is cached under. */
export const BROADCASTS_JOB_MODULE = "communication";
