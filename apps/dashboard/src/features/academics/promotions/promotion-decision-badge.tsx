"use client";

import { useTranslations } from "next-intl";
import { Badge, BadgeDot, type BadgeProps } from "@schoolhub/ui";

import type { PromotionDecisionValue } from "@/services";
import { PROMOTION_DECISION } from "@/services/modules/promotions/promotions-constant";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * A decision's badge colour, from the theme's variants only. Typed over every decision, so one
 * the API adds is a compile error here until it is given a colour.
 */
export const PROMOTION_DECISION_VARIANT: Record<PromotionDecisionValue, BadgeVariant> = {
  [PROMOTION_DECISION.promoted]: "success",
  [PROMOTION_DECISION.retained]: "warning",
  [PROMOTION_DECISION.promoted_on_trial]: "info",
  [PROMOTION_DECISION.graduated]: "primary",
};

export interface PromotionDecisionBadgeProps {
  decision: PromotionDecisionValue;
}

/** A student's decision as a translated label with a dot, so colour never carries it alone. */
export function PromotionDecisionBadge({ decision }: PromotionDecisionBadgeProps) {
  const t = useTranslations("academics");

  return (
    <Badge variant={PROMOTION_DECISION_VARIANT[decision]} appearance="light">
      <BadgeDot />
      {t(`promotions.decisionValue.${decision}`)}
    </Badge>
  );
}
