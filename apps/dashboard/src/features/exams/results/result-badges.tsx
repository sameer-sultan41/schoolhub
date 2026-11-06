"use client";

import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@schoolhub/ui";
import {
  Ban,
  CircleCheck,
  CircleX,
  Cog,
  Hourglass,
  Send,
  UserX,
  type LucideIcon,
} from "lucide-react";

import type { ResultOutcome, ResultStatus } from "@/services";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;
interface BadgeStyle {
  icon: LucideIcon;
  variant: BadgeVariant;
}

/** Typed over every status and outcome, so one the API adds is a compile error until styled. */
const STATUS_STYLE: Record<ResultStatus, BadgeStyle> = {
  processing: { icon: Cog, variant: "secondary" },
  pending_approval: { icon: Hourglass, variant: "warning" },
  approved: { icon: CircleCheck, variant: "info" },
  published: { icon: Send, variant: "success" },
};

const OUTCOME_STYLE: Record<ResultOutcome, BadgeStyle> = {
  pass: { icon: CircleCheck, variant: "success" },
  fail: { icon: CircleX, variant: "destructive" },
  absent: { icon: UserX, variant: "secondary" },
  withheld: { icon: Ban, variant: "rose" },
};

function StyledBadge({ style, label }: { style: BadgeStyle; label: string }) {
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} appearance="light">
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** A result's place in the approval chain as token, icon and label together. */
export function ResultStatusBadge({ status }: { status: ResultStatus }) {
  const t = useTranslations("exams");
  return <StyledBadge style={STATUS_STYLE[status]} label={t(`results.status.${status}`)} />;
}

/** A result's outcome as token, icon and label together; `withheld` holds it from publication. */
export function ResultOutcomeBadge({ outcome }: { outcome: ResultOutcome }) {
  const t = useTranslations("exams");
  return <StyledBadge style={OUTCOME_STYLE[outcome]} label={t(`results.outcome.${outcome}`)} />;
}
