"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services, type AcademicSessionSummary } from "@/services";
import { LOCKED_SESSION_STATUSES } from "@/services/modules/school-organization/school-organization-constant";

export interface AcademicSessionState {
  sessions: AcademicSessionSummary[] | undefined;
  /** The URL's session if it exists, else the current one, else `null`. */
  session: AcademicSessionSummary | null;
  /** Closed or archived: the session's records are read-only. */
  isLocked: boolean;
  isLoading: boolean;
  /** The sessions could not be loaded and none are cached: not the same as "no session". */
  isError: boolean;
  /** Re-requests the sessions, for a retry after `isError`. */
  refetch: () => Promise<unknown>;
}

/**
 * The academic session a session-scoped screen (Academics, Timetable) works on. `urlSessionId` is the screen's `session`
 * URL value, where `""` (or an id that is no longer a session) means "the current session".
 * Shares its cache entry with every other academic-sessions list, so it adds no request.
 */
export function useAcademicSession(urlSessionId: string): AcademicSessionState {
  const {
    data: sessions,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.list("school-organization", "academic-sessions"),
    queryFn: () => Services.schoolOrganization.fetchAcademicSessions(),
  });

  const session =
    sessions?.find((candidate) => candidate.id === urlSessionId) ??
    sessions?.find((candidate) => candidate.is_current) ??
    null;
  const isLocked = session !== null && LOCKED_SESSION_STATUSES.includes(session.status);

  return {
    sessions,
    session,
    isLocked,
    isLoading: isPending,
    // A failed background refetch that still has sessions to show is not an error state.
    isError: isError && sessions === undefined,
    refetch,
  };
}
