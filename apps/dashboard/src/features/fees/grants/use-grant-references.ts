"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { FINE_HEAD_CATEGORY } from "@/services/modules/fines/fines-constant";
import type { NameLookups } from "@/features/fees/shared/name-lookup";
import { useFeeHeadOptions } from "@/features/fees/shared/use-fee-options";

/**
 * What the grants tabs read beyond their own list, each only for a holder of its view key (L55):
 * the sessions and fee heads a table names and a form picks from. `canPick*` say whether each
 * picker a create form needs can be filled, so a writer who could open the form but never save
 * it sees no create button (L59). The student picker searches the students list, which needs
 * `students.student.view`.
 */
export function useGrantReferences() {
  const { data: user } = useCurrentUser();
  const canReadSessions = hasPermission(user, "school.academic-session.view");
  const canReadHeads = hasPermission(user, "fees.fee-structure.view");
  const canPickStudent = hasPermission(user, "students.student.view");

  const sessionsQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "academic-sessions"),
    queryFn: () => Services.schoolOrganization.fetchAcademicSessions(),
    enabled: canReadSessions,
  });
  const headsQuery = useFeeHeadOptions({ enabled: canReadHeads });

  const sessions = sessionsQuery.data;
  const heads = headsQuery.data;
  const fineHeads = useMemo(
    () => (heads ?? []).filter((head) => head.category === FINE_HEAD_CATEGORY && head.is_active),
    [heads],
  );
  const lookups = useMemo<NameLookups>(
    () => ({
      sessions: new Map((sessions ?? []).map((session) => [session.id, session.name])),
      heads: new Map((heads ?? []).map((head) => [head.id, head.name])),
    }),
    [sessions, heads],
  );

  return {
    sessions: sessions ?? [],
    heads: heads ?? [],
    fineHeads,
    lookups,
    canReadSessions,
    canReadHeads,
    canPickStudent,
    isLoading: sessionsQuery.isLoading || headsQuery.isLoading,
  };
}
