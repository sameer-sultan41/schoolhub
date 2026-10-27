import type { AuthenticatedUser } from "@schoolhub/types";

import { FILTER_ALL } from "@/lib/constants";

/**
 * The pure pieces every approval queue shares (attendance corrections, student leave): the
 * decision body, the status set and filter, and the part of the Approve / Reject gate that is
 * the same in each. A queue's own rules (who counts as "own", an earlier level) stay in its
 * module's helper.
 */

export const APPROVAL_STATUS_PENDING = "pending" as const;

/** The `:approve` / `:reject` body: `{ [noteField]: note }` when there is a note, else `{}`. */
export function toDecisionBody<Field extends string>(
  noteField: Field,
  note?: string,
): Partial<Record<Field, string>> {
  const trimmed = note?.trim();
  return trimmed ? ({ [noteField]: trimmed } as Record<Field, string>) : {};
}

/** The statuses of a `Record<Status, true>`, a set the compiler checks against the generated enum. */
export function statusesOf<Status extends string>(set: Readonly<Record<Status, true>>): Status[] {
  return Object.keys(set) as Status[];
}

/** The status filter's value: `all` is no filter, any other value is the status. A queue
 * narrows it to its own status type. */
export function statusFilterValue(value: string): string | undefined {
  return value === FILTER_ALL ? undefined : value;
}

/** Whether `actorId` (a request's requester or submitter) is the viewer. */
export function isViewer(actorId: string, user: AuthenticatedUser | undefined): boolean {
  return user !== undefined && actorId === user.id;
}

/**
 * Whether a decision is offered before a queue's own rules: the user has loaded, holds the
 * queue's approve key (`canApprove`), and the request is pending. The server enforces each of
 * these itself.
 */
export function canDecidePending(
  request: { status: string },
  user: AuthenticatedUser | undefined,
  canApprove: boolean,
): boolean {
  return user !== undefined && canApprove && request.status === APPROVAL_STATUS_PENDING;
}
