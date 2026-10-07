"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryObserverResult,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge, Button, Skeleton } from "@schoolhub/ui";

import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { GuardianLinkRecord, GuardianRecord } from "@/services";
import { GuardianFormDialog } from "./guardian-form-dialog";
import { GuardianLinkFlagsDialog } from "./guardian-link-flags-dialog";
import { GuardianPickerDialog } from "./guardian-picker-dialog";

const FLAG_LABELS: { key: keyof GuardianLinkRecord; labelKey: string }[] = [
  { key: "is_fee_responsible", labelKey: "feeResponsible" },
  { key: "can_pick_up", labelKey: "canPickUp" },
  { key: "receives_communications", labelKey: "receivesCommunications" },
  { key: "has_portal_access", labelKey: "hasPortalAccess" },
];

export interface StudentGuardiansTabProps {
  studentId: string;
  canCreate: boolean;
  canUpdate: boolean;
}

export function StudentGuardiansTab({ studentId, canCreate, canUpdate }: StudentGuardiansTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [pickerOpen, setPickerOpen] = useState(false);
  // A guardian the picker already created (its "Create new" tab succeeded) but hasn't
  // linked yet — held here, one level up from `GuardianPickerDialog`, so Cancel/closing
  // the picker before the link step completes doesn't lose it. The picker has no delete
  // endpoint for guardians and `GuardianViewSet` only surfaces campus-scoped guardians
  // with at least one student link, so a guardian created and then abandoned here would
  // otherwise be permanently unfindable the next time anyone searches (round-8 review
  // finding). Cleared once `onLinked` actually fires for it.
  const [pendingGuardian, setPendingGuardian] = useState<GuardianRecord | null>(null);
  const [editingGuardian, setEditingGuardian] = useState<GuardianRecord | null>(null);
  const [editingLink, setEditingLink] = useState<GuardianLinkRecord | null>(null);

  const linksQuery = useQuery({
    queryKey: queryKeys.list("students", "guardian-links", { studentId }),
    queryFn: () => Services.guardians.fetchGuardianLinks(studentId),
  });
  // Memoized (not a bare `?? []`) so its identity is stable across renders where
  // `linksQuery.data` itself hasn't changed — `guardianIds` below depends on `links`,
  // and a fresh `[]` literal on every render with no data yet would otherwise defeat
  // that memoization (`react-hooks/exhaustive-deps` catches exactly this).
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);

  // The link list never embeds the guardian's own name/phone (confirmed real API shape
  // — see this plan's Global Constraints) — fan out one GET per unique guardian id,
  // through `Services.guardians.fetchGuardianById` (Task 2), never a direct
  // `apiClient`/`endpoints` import inside this component (ADR-0011).
  // Memoized on `links`, not recomputed as a fresh array every render — `combine` below
  // closes over this, and TanStack Query's own guidance is that `combine` must be
  // referentially stable (wrap it in `useCallback`) or its memoization never holds.
  const guardianIds = useMemo(() => [...new Set(links.map((link) => link.guardian_id))], [links]);
  // `combine` turns N independent query results into one lookup this component actually
  // wants: per-id data where it resolved, and which ids failed — a bare useQueries array
  // forces re-deriving this from scratch on every render and makes it easy to drop a
  // failed lookup silently (the bug this exact shape was added to fix).
  const combineGuardianResults = useCallback(
    (results: QueryObserverResult<GuardianRecord>[]) => ({
      byId: new Map(
        results
          .map((result) => result.data)
          .filter((g): g is GuardianRecord => Boolean(g))
          .map((g) => [g.id, g] as const),
      ),
      failedIds: new Set(
        results
          .map((result, index) => (result.isError ? guardianIds[index] : null))
          .filter((id): id is string => id !== null),
      ),
      refetchAllFailed: () => {
        for (const result of results) {
          if (result.isError) void result.refetch();
        }
      },
    }),
    [guardianIds],
  );
  const guardianResults = useQueries({
    queries: guardianIds.map((guardianId) => ({
      queryKey: queryKeys.detail("guardians", "guardians", guardianId),
      queryFn: () => Services.guardians.fetchGuardianById(guardianId),
      // A guardian's own name/phone rarely changes mid-session — re-fetching every one
      // of up to a handful of guardians on every tab reopen spends part of the 60/min
      // per-user rate limit (ADR-0020) for data that's almost always still correct.
      staleTime: 5 * 60 * 1000,
    })),
    combine: combineGuardianResults,
  });
  const guardiansById = guardianResults.byId;
  const failedGuardianIds = guardianResults.failedIds;
  const retryFailedGuardians = guardianResults.refetchAllFailed;

  function invalidateLinks() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "guardian-links", { studentId }),
    });
  }

  const promoteMutation = useMutation({
    mutationFn: (linkId: string) =>
      Services.guardians.updateGuardianLink(linkId, { isPrimary: true }),
    onSuccess: invalidateLinks,
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("guardians.promoteFailed")));
    },
  });

  if (linksQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (linksQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("guardians.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void linksQuery.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("guardians.title")}</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setPickerOpen(true);
            }}
          >
            {t("guardians.link")}
          </Button>
        )}
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("guardians.empty")}</p>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const guardian = guardiansById.get(link.guardian_id);
            const guardianFailed = failedGuardianIds.has(link.guardian_id);
            return (
              <div key={link.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    {guardianFailed ? (
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-destructive">
                          {t("guardians.guardianLoadError")}
                        </p>
                        <Button mode="link" size="sm" onClick={retryFailedGuardians}>
                          {tCommon("retry")}
                        </Button>
                      </div>
                    ) : guardian ? (
                      <p className="text-sm font-medium text-foreground">
                        {guardian.first_name} {guardian.last_name}
                      </p>
                    ) : (
                      <Skeleton className="h-4 w-32" />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t(`guardians.relationship.${link.relationship}`)}
                      {guardian ? ` · ${guardian.phone}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {link.is_primary ? (
                      <Badge>{t("guardians.primary")}</Badge>
                    ) : (
                      canUpdate && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={promoteMutation.isPending}
                          // Row-specific accessible name (WCAG 2.4.6) — every row's button
                          // otherwise shares the exact same text, so a screen-reader user
                          // can't tell which guardian "Make primary" would act on.
                          aria-label={
                            guardian
                              ? `${t("guardians.makePrimary")} — ${guardian.first_name} ${guardian.last_name}`
                              : t("guardians.makePrimary")
                          }
                          onClick={() => {
                            promoteMutation.mutate(link.id);
                          }}
                        >
                          {t("guardians.makePrimary")}
                        </Button>
                      )
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FLAG_LABELS.filter(({ key }) => link[key]).map(({ labelKey }) => (
                    <Badge key={labelKey} variant="outline">
                      {t(`guardians.flags.${labelKey}`)}
                    </Badge>
                  ))}
                </div>
                {canUpdate && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={
                        guardian
                          ? `${t("guardians.editLinkTitle")} — ${guardian.first_name} ${guardian.last_name}`
                          : t("guardians.editLinkTitle")
                      }
                      onClick={() => {
                        setEditingLink(link);
                      }}
                    >
                      {t("guardians.editLinkTitle")}
                    </Button>
                    {guardian && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`${t("guardians.editGuardianTitle")} — ${guardian.first_name} ${guardian.last_name}`}
                        onClick={() => {
                          setEditingGuardian(guardian);
                        }}
                      >
                        {t("guardians.editGuardianTitle")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <GuardianPickerDialog
          open
          studentId={studentId}
          excludedGuardianIds={links.map((link) => link.guardian_id)}
          isFirstGuardian={links.length === 0}
          resumeGuardian={pendingGuardian}
          onGuardianCreated={setPendingGuardian}
          onOpenChange={(open) => {
            if (!open) setPickerOpen(false);
          }}
          onLinked={() => {
            setPendingGuardian(null);
            invalidateLinks();
          }}
        />
      )}
      {editingLink && (
        <GuardianLinkFlagsDialog
          open
          link={editingLink}
          onOpenChange={(open) => {
            if (!open) setEditingLink(null);
          }}
          onSaved={invalidateLinks}
        />
      )}
      {editingGuardian && (
        <GuardianFormDialog
          open
          guardian={editingGuardian}
          onOpenChange={(open) => {
            if (!open) setEditingGuardian(null);
          }}
          onSaved={() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.detail("guardians", "guardians", editingGuardian.id),
            });
            setEditingGuardian(null);
          }}
        />
      )}
    </div>
  );
}
