"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { Library } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import {
  QUESTION_BANKS_DETAIL_RESOURCE,
  QUESTION_BANKS_QUERY_MODULE,
} from "@/services/modules/question-banks/question-banks-constant";
import { BankHeader } from "./bank-header";
import { QuestionsTable } from "./questions-table";

/**
 * One question bank: its header, then its questions. A bank the API can't find says so, with a
 * way back: the API answers 404 alike for another school's bank and for one outside an
 * `assigned` teacher's subjects.
 */
export function BankPage({ bankId }: { bankId: string }) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const query = useQuery({
    queryKey: queryKeys.detail(QUESTION_BANKS_QUERY_MODULE, QUESTION_BANKS_DETAIL_RESOURCE, bankId),
    queryFn: () => Services.questionBanks.fetchBank(bankId),
  });
  const { data: bank, error, isPending } = query;

  if (bank) {
    return (
      <>
        <BankHeader bank={bank} />
        <QuestionsTable bankId={bank.id} />
      </>
    );
  }

  if (isPending) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error instanceof ApiError && error.isNotFound) {
    return (
      <EmptyState
        icon={Library}
        title={t("questionBanks.detail.notFoundTitle")}
        description={t("questionBanks.detail.notFoundDescription")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.EXAMS_QUESTION_BANKS}>{t("questionBanks.actions.backToList")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <LoadErrorCard
      message={resolveErrorMessage(error, tErrors, t("questionBanks.detail.loadError"))}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
