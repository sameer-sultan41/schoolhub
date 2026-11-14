"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Checkbox, Skeleton } from "@schoolhub/ui";
import { useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import {
  Services,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferenceRow,
} from "@/services";
import { NOTIFICATION_CATEGORIES } from "@/services/modules/notifications/notifications-constant";
import {
  LOCKED_CATEGORY,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PREFERENCES_QUERY_MODULE,
} from "@/services/modules/notification-preferences/notification-preferences-constant";
import { NOTIFICATION_CATEGORY_LABEL_KEY } from "@/features/portal/notifications/notification-labels";
import { NOTIFICATION_CHANNEL_LABEL_KEY } from "./preference-labels";
import { enumLabel } from "@/lib/enum-label";

const cellKey = (category: string, channel: string) => `${category}:${channel}`;

/** Only the emergency category is locked, on every channel: the server refuses to disable it. */
function isLocked(category: NotificationCategory): boolean {
  return category === LOCKED_CATEGORY;
}

/** `/portal/settings`: the viewer's category x channel notification matrix. */
export function PortalPreferences() {
  const t = useTranslations("portal.preferences");
  const tNotifications = useTranslations("portal.notifications");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const queryKey = queryKeys.detail(NOTIFICATION_PREFERENCES_QUERY_MODULE, "matrix", "current");

  const matrix = useQuery({
    queryKey,
    queryFn: () => Services.notificationPreferences.fetchNotificationPreferences(),
  });
  const update = useMutation({
    mutationFn: (change: {
      category: NotificationCategory;
      channel: NotificationChannel;
      enabled: boolean;
    }) =>
      Services.notificationPreferences.updateNotificationPreferences([
        { event_category: change.category, channel: change.channel, is_enabled: change.enabled },
      ]),
    // The answer is the whole matrix, so the cache takes it as it is.
    onSuccess: (rows: NotificationPreferenceRow[]) => {
      queryClient.setQueryData(queryKey, rows);
    },
  });

  if (matrix.isPending) return <Skeleton className="h-48 w-full" />;
  if (matrix.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(matrix.error, tErrors, t("loadError"))}
        onRetry={() => {
          void matrix.refetch();
        }}
      />
    );
  }

  // A pair with no row is enabled, as on the server.
  const enabled = new Map(
    matrix.data.map((row) => [cellKey(row.event_category, row.channel), row.is_enabled]),
  );

  return (
    <section className="space-y-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("lockedExplanation")}</p>
      {update.isError && (
        <Alert variant="destructive">
          {resolveErrorMessage(update.error, tErrors, t("saveFailed"))}
        </Alert>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="border-b border-border text-start">
              <th scope="col" className="p-2 text-start font-medium text-foreground">
                {t("category")}
              </th>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <th key={channel} scope="col" className="p-2 text-center font-medium">
                  {enumLabel(t, NOTIFICATION_CHANNEL_LABEL_KEY, channel)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <tr key={category} className="border-b border-border">
                <th scope="row" className="p-2 text-start font-normal text-foreground">
                  {enumLabel(tNotifications, NOTIFICATION_CATEGORY_LABEL_KEY, category)}
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const locked = isLocked(category);
                  const key = cellKey(category, channel);
                  return (
                    <td key={channel} className="p-2 text-center">
                      <Checkbox
                        aria-label={t("cellLabel", {
                          category: enumLabel(
                            tNotifications,
                            NOTIFICATION_CATEGORY_LABEL_KEY,
                            category,
                          ),
                          channel: enumLabel(t, NOTIFICATION_CHANNEL_LABEL_KEY, channel),
                        })}
                        checked={locked || (enabled.get(key) ?? true)}
                        // One save at a time, so responses cannot land out of order.
                        disabled={locked || update.isPending}
                        onCheckedChange={(checked) => {
                          update.mutate({ category, channel, enabled: checked === true });
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
