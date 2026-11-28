"use client";

import { useQueries } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { enumLabel } from "@/lib/enum-label";
import { Services, type OverUsage } from "@/services";
import { tenantDetailKey } from "./platform-query-keys";
import { usePlatformErrorDescriber } from "./use-platform-error";

const METRIC_LABELS: Record<string, string> = {
  students: "usage.metrics.students",
  staff: "usage.metrics.staff",
  storage_gb: "usage.metrics.storage_gb",
  sms_credits: "usage.metrics.sms_credits",
  ai_tokens: "usage.metrics.ai_tokens",
};

/**
 * The 409 `limit_below_usage` answered: each breach in `meta.over_usage` (a school whose latest
 * snapshot is over a lowered limit), grouped under the school's name, and a resend of the same
 * change with `acknowledge_over_usage: true`. Cancel keeps the form as it was, unsaved.
 * `meta.over_usage` carries only the school's id, so each name is read through the school's own
 * query (shared with its page); until it loads, or if it can't be read, the id shows.
 *
 * Mounting contract: mounted only while a refusal is being answered, so it starts with no error.
 */
export function AcknowledgeOverUsageDialog<TResult>({
  breaches,
  onCancel,
  resend,
  onSaved,
}: {
  breaches: readonly OverUsage[];
  onCancel: () => void;
  /** The same change, acknowledged. */
  resend: () => Promise<TResult>;
  onSaved: (result: TResult) => void;
}) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const describeError = usePlatformErrorDescriber();

  const schoolIds = [...new Set(breaches.map((breach) => breach.tenant_id))];
  const schools = useQueries({
    queries: schoolIds.map((id) => ({
      queryKey: tenantDetailKey(id),
      queryFn: () => Services.platform.fetchTenant(id),
    })),
  });

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: resend,
    onSuccess: onSaved,
    fallbackMessage: tCommon("submitFailed"),
    describeError,
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t("overUsage.title")}
      description={t("overUsage.description")}
      confirmLabel={t("overUsage.confirm")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    >
      <ul className="space-y-2 text-sm">
        {schoolIds.map((id, index) => (
          <li key={id}>
            <p className="font-medium">{schools[index]?.data?.name ?? id}</p>
            <ul className="space-y-1 ps-4">
              {breaches
                .filter((breach) => breach.tenant_id === id)
                .map((breach) => (
                  <li key={breach.metric}>
                    {t("overUsage.breach", {
                      metric: enumLabel(t, METRIC_LABELS, breach.metric),
                      usage: breach.usage.toLocaleString(locale),
                      limit: breach.limit.toLocaleString(locale),
                    })}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </ResponsiveAlertDialog>
  );
}
