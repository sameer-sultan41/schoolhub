"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type FeatureOverrideRecord, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { OverrideFormDialog, RemoveOverrideDialog } from "./override-dialogs";

/**
 * A school's live feature overrides: each flag, on or off, why, and until when. A viewer with
 * `platform.feature-flag.update` may add one (it replaces any override of the same flag) or remove
 * one. The resolution order is override, then plan, then the flag's default.
 */
export function TenantOverridesTab({ tenant }: { tenant: TenantRecord }) {
  const t = useTranslations("platform.overrides");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, PLATFORM_KEYS.flagUpdate);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FeatureOverrideRecord | null>(null);

  const query = useQuery({
    queryKey: queryKeys.detail(PLATFORM_QUERY_MODULE, "overrides", tenant.id),
    queryFn: () => Services.platform.fetchOverrides(tenant.id),
  });

  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("summary")}</p>
          {canUpdate && (
            <Button
              onClick={() => {
                setAdding(true);
              }}
            >
              <Plus aria-hidden="true" />
              {t("create")}
            </Button>
          )}
        </div>
        {query.data === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : query.data.length === 0 ? (
          <p className="text-sm">{t("empty")}</p>
        ) : (
          <Table>
            <TableCaption className="sr-only">{t("caption", { name: tenant.name })}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("flag")}</TableHead>
                <TableHead>{t("state")}</TableHead>
                <TableHead>{t("reason")}</TableHead>
                <TableHead>{t("expiresAt")}</TableHead>
                {canUpdate && <TableHead>{t("actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((override) => (
                <TableRow key={override.id}>
                  <TableCell className="font-mono text-sm">{override.flag}</TableCell>
                  <TableCell>
                    <Badge variant={override.enabled ? "success" : "secondary"} appearance="light">
                      {t(override.enabled ? "on" : "off")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{override.reason}</TableCell>
                  <TableCell className="text-sm">
                    {override.expires_at ? formatDate(override.expires_at, locale) : t("never")}
                  </TableCell>
                  {canUpdate && (
                    <TableCell>
                      <RowEditRemoveActions
                        removeLabel={t("removeRow", { flag: override.flag })}
                        onRemove={() => {
                          setRemoving(override);
                        }}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {adding && (
        <OverrideFormDialog
          tenant={tenant}
          onOpenChange={(open) => {
            if (!open) setAdding(false);
          }}
        />
      )}
      {removing && (
        <RemoveOverrideDialog
          tenant={tenant}
          override={removing}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
        />
      )}
    </Card>
  );
}
