"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ArrowLeft } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import type { PromotionBatchDetail } from "@/services";
import { PromotionStatusBadge } from "./promotion-status-badge";

export interface PromotionBatchHeaderProps {
  batch: PromotionBatchDetail;
}

/**
 * The batch's title, class, sessions, student count and status. The status badge here is the
 * only place the page says the batch's status: every decision row shares it.
 */
export function PromotionBatchHeader({ batch }: PromotionBatchHeaderProps) {
  const t = useTranslations("academics");

  return (
    <Toolbar>
      <ToolbarHeading
        title={t("promotions.review.title")}
        description={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-medium text-foreground">{batch.from_class_name}</span>
            <span>
              {t("promotions.sessionPair", {
                from: batch.from_academic_session_name,
                to: batch.to_academic_session_name,
              })}
            </span>
            <span>{t("promotions.review.studentCount", { count: batch.students })}</span>
            <PromotionStatusBadge status={batch.status} />
          </div>
        }
      />
      <ToolbarActions>
        <Button variant="outline" asChild>
          <Link href={Paths.ACADEMICS_PROMOTIONS}>
            <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
            {t("promotions.actions.backToList")}
          </Link>
        </Button>
      </ToolbarActions>
    </Toolbar>
  );
}
