"use client";

import { useLocale, useTranslations } from "next-intl";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { enumLabel } from "@/lib/enum-label";
import type { OverUsage } from "@/services";
import { usePlatformErrorDescriber } from "./use-platform-error";

/** Schools listed before "and N more": a plan edit can catch many, and the dialog must stay
 * readable. */
const LISTED_SCHOOLS = 20;

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
 * Each entry names its school (`tenant_name`, `slug`), so no request is made per school; the
 * first `LISTED_SCHOOLS` are listed, then how many more.
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

  const schools = [...new Map(breaches.map((breach) => [breach.tenant_id, breach])).values()];
  const listed = schools.slice(0, LISTED_SCHOOLS);
  const unlisted = schools.length - listed.length;

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
        {listed.map((school) => (
          <li key={school.tenant_id}>
            <p className="font-medium">{school.tenant_name || school.slug || school.tenant_id}</p>
            <ul className="space-y-1 ps-4">
              {breaches
                .filter((breach) => breach.tenant_id === school.tenant_id)
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
        {unlisted > 0 && (
          <li className="text-muted-foreground">{t("overUsage.more", { count: unlisted })}</li>
        )}
      </ul>
    </ResponsiveAlertDialog>
  );
}
