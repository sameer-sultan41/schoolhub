"use client";

import { useTranslations } from "next-intl";
import { Badge, BadgeDot, type BadgeProps } from "@schoolhub/ui";

import type { PromotionStatus } from "@/services";
import { PROMOTION_STATUS } from "@/services/modules/promotions/promotions-constant";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * A batch status's badge colour, from the theme's variants only. Typed over every status, so a
 * status the API adds is a compile error here until it is given one.
 */
const PROMOTION_STATUS_VARIANT: Record<PromotionStatus, BadgeVariant> = {
  [PROMOTION_STATUS.draft]: "secondary",
  [PROMOTION_STATUS.pending_approval]: "warning",
  [PROMOTION_STATUS.approved]: "info",
  [PROMOTION_STATUS.executed]: "success",
  [PROMOTION_STATUS.reverted]: "destructive",
};

export interface PromotionStatusBadgeProps {
  status: PromotionStatus;
}

/** A batch's status as a translated label with a dot, so colour never carries it alone. */
export function PromotionStatusBadge({ status }: PromotionStatusBadgeProps) {
  const t = useTranslations("academics");

  return (
    <Badge size="lg" variant={PROMOTION_STATUS_VARIANT[status]} appearance="light" shape="circle">
      <BadgeDot />
      {t(`promotions.status.${status}`)}
    </Badge>
  );
}
