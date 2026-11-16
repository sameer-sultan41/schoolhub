"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription, Button, Skeleton } from "@schoolhub/ui";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetTitle,
} from "@/components/responsive-dialog";
import { LoadErrorCard } from "@/components/load-error-card";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { EMPTY_VALUE } from "@/lib/constants";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { formatLastUpdated } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type ContactSubmissionStatus } from "@/services";
import { CONTACT_SUBMISSIONS_RESOURCE } from "@/services/modules/website/contact-submissions/contact-submissions-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { ContentFact } from "@/features/website/shared/content-detail-sheet";
import { withReasonText } from "@/features/website/shared/reason-message";
import { ContactStatusBadge } from "./contact-status-badge";

/** The statuses a person sets by hand; `new` is where every message starts. */
const TRIAGE_STATUSES = [
  "read",
  "responded",
  "spam",
] as const satisfies readonly ContactSubmissionStatus[];
type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/**
 * One contact message: who sent it, how to reach them, the subject and the message. Opening it
 * changes nothing; Mark read, responded or spam (with `website.contact-submission.update`) each
 * save the status, and a refusal shows here in the viewer's language.
 *
 * Mounting contract: the caller mounts this only while a message is open.
 */
export function ContactDetailSheet({
  submissionId,
  canUpdate,
  onOpenChange,
}: {
  submissionId: string;
  canUpdate: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("website.inbox");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tReasons = useTranslations("website.reasons");
  const locale = useLocale();
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const queryClient = useQueryClient();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const [error, setError] = useState<string | null>(null);
  const detailKey = queryKeys.detail(
    WEBSITE_QUERY_MODULE,
    CONTACT_SUBMISSIONS_RESOURCE,
    submissionId,
  );

  const query = useQuery({
    queryKey: detailKey,
    queryFn: () => Services.contactSubmissions.fetchContactSubmission(submissionId),
  });
  const triage = useMutation({
    mutationFn: async (status: TriageStatus) => {
      try {
        return await Services.contactSubmissions.setContactSubmissionStatus(submissionId, status);
      } catch (refusal) {
        throw withReasonText(refusal, tReasons);
      }
    },
    onSuccess: (saved, status) => {
      queryClient.setQueryData(detailKey, saved);
      invalidateWebsite();
      toast.success(t(`actions.done.${status}`));
    },
    onError: (refusal) => {
      setError(
        resolveErrorMessage(
          foldUnknownFieldErrors(refusal),
          tErrors,
          tCommon("submitFailed"),
          NON_FIELD,
        ),
      );
    },
  });
  const message = query.data;

  return (
    <ResponsiveSheet open onOpenChange={onOpenChange}>
      <ResponsiveSheetContent
        closeLabel={tCommon("close")}
        className="gap-0 p-0 sm:w-[520px] sm:max-w-none"
      >
        <div className="flex flex-col gap-1.5 border-b border-border px-6 py-5 pe-14">
          <ResponsiveSheetTitle className="text-lg font-semibold">
            {message ? message.name : t("detail.loadingTitle")}
          </ResponsiveSheetTitle>
          {message ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ContactStatusBadge status={message.status} />
              <span>
                {t("detail.lastUpdated", { when: formatLastUpdated(message.updated_at) })}
              </span>
            </div>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </div>
        <ResponsiveSheetBody className="flex flex-col gap-6 px-6 py-5">
          {query.isError && message === undefined ? (
            <LoadErrorCard
              message={resolveErrorMessage(query.error, tErrors, t("detail.loadError"))}
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : message ? (
            <>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
                <ContentFact label={t("detail.received")}>
                  {dateTime.format(new Date(message.created_at))}
                </ContentFact>
                <ContentFact label={t("detail.subject")}>
                  {message.subject || t("noSubject")}
                </ContentFact>
                <ContentFact label={t("detail.email")}>
                  {message.email ? (
                    <a
                      dir="ltr"
                      href={`mailto:${message.email}`}
                      className="text-primary hover:underline"
                    >
                      {message.email}
                    </a>
                  ) : (
                    EMPTY_VALUE
                  )}
                </ContentFact>
                <ContentFact label={t("detail.phone")}>
                  {message.phone ? (
                    <a
                      dir="ltr"
                      href={`tel:${message.phone}`}
                      className="text-primary hover:underline"
                    >
                      {message.phone}
                    </a>
                  ) : (
                    EMPTY_VALUE
                  )}
                </ContentFact>
              </dl>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">{t("detail.message")}</h3>
                <p className="text-sm break-words whitespace-pre-wrap text-foreground">
                  {message.message}
                </p>
              </section>
            </>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </ResponsiveSheetBody>
        {message && canUpdate ? (
          <ResponsiveSheetFooter className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
            {TRIAGE_STATUSES.filter((status) => status !== message.status).map((status) => (
              <Button
                key={status}
                type="button"
                variant={status === "spam" ? "outline" : "primary"}
                isLoading={triage.isPending && triage.variables === status}
                loadingLabel={tCommon("saving")}
                disabled={triage.isPending}
                onClick={() => {
                  setError(null);
                  triage.mutate(status);
                }}
              >
                {t(`actions.${status}`)}
              </Button>
            ))}
          </ResponsiveSheetFooter>
        ) : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
