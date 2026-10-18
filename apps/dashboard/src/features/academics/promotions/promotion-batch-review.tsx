"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { Layers } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { resolveErrorMessage } from "@/lib/error-message";
import { ApiError, Services } from "@/services";
import { PromotionBatchActions } from "./promotion-batch-actions";
import { PromotionBatchHeader } from "./promotion-batch-header";
import { PromotionDecisionTable } from "./promotion-decision-table";
import { promotionBatchKey } from "./use-promotion-batch-cache";

export interface PromotionBatchReviewProps {
  batchId: string;
}

/**
 * One promotion batch to review: its status and class, what the viewer can do to it, the
 * execution's report once it has run, and every student's decision. A batch the API can't find
 * (or that another school owns: the API answers 404 for both) says so, with a way back.
 */
export function PromotionBatchReview({ batchId }: PromotionBatchReviewProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const query = useQuery({
    queryKey: promotionBatchKey(batchId),
    queryFn: () => Services.promotions.fetchPromotionBatch(batchId),
  });
  const { data: batch, error, isPending } = query;

  if (batch) {
    return (
      <>
        <PromotionBatchHeader batch={batch} />
        <div className="space-y-5">
          <PromotionBatchActions batch={batch} />
          <PromotionDecisionTable batch={batch} />
        </div>
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
        icon={Layers}
        title={t("promotions.review.notFoundTitle")}
        description={t("promotions.review.notFoundDescription")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.ACADEMICS_PROMOTIONS}>{t("promotions.actions.backToList")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <LoadErrorCard
      message={resolveErrorMessage(error, tErrors, t("promotions.review.loadError"))}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
