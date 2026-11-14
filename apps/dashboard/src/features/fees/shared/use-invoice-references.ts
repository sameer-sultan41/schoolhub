"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { useFeeStructureOptions } from "./use-fee-options";
import type { NamedOption } from "./use-structure-references";

/** An empty array kept stable, so a memo over a list that is not read yet does not rebuild. */
const NONE: readonly NamedOption[] = [];

/**
 * The sessions and structures an invoice list filters by and an invoice dialog picks from, and
 * each id's name for a table cell. Each list is read only for a holder of its view key (L55), so
 * a viewer without one sees no picker and an unnamed cell, never a failed request.
 */
export function useInvoiceReferences() {
  const { data: user } = useCurrentUser();
  const canReadSessions = hasPermission(user, "school.academic-session.view");
  const canReadStructures = hasPermission(user, "fees.fee-structure.view");

  const sessionsQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "academic-sessions"),
    queryFn: () => Services.schoolOrganization.fetchAcademicSessions(),
    enabled: canReadSessions,
  });
  const structuresQuery = useFeeStructureOptions({ enabled: canReadStructures });

  const sessions: readonly NamedOption[] = sessionsQuery.data ?? NONE;
  const structureRecords = structuresQuery.data;
  const structures = useMemo<readonly NamedOption[]>(
    () => structureRecords?.map(({ id, name }) => ({ id, name })) ?? NONE,
    [structureRecords],
  );

  const names = useMemo(() => {
    const byId = (options: readonly NamedOption[]) =>
      new Map(options.map((option) => [option.id, option.name]));
    return { sessions: byId(sessions), structures: byId(structures) };
  }, [sessions, structures]);

  return {
    sessions,
    structures,
    names,
    canReadSessions,
    canReadStructures,
    isLoading: sessionsQuery.isLoading || structuresQuery.isLoading,
  };
}
