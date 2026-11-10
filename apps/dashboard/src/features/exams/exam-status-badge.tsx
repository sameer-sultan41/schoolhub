"use client";

import { useTranslations } from "next-intl";
import { Badge, type BadgeProps } from "@schoolhub/ui";
import {
  Archive,
  CalendarClock,
  CircleCheck,
  CirclePlay,
  ClipboardPen,
  Cog,
  FilePen,
  Send,
  type LucideIcon,
} from "lucide-react";

import type { ExamStatus } from "@/services";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Each status's icon and theme variant, typed over every status so one the API adds is a
 * compile error here until it is given both. */
export const EXAM_STATUS_STYLE: Record<ExamStatus, { icon: LucideIcon; variant: BadgeVariant }> = {
  draft: { icon: FilePen, variant: "outline" },
  scheduled: { icon: CalendarClock, variant: "info" },
  ongoing: { icon: CirclePlay, variant: "primary" },
  marks_entry: { icon: ClipboardPen, variant: "warning" },
  processing: { icon: Cog, variant: "warning" },
  approved: { icon: CircleCheck, variant: "success" },
  published: { icon: Send, variant: "success" },
  archived: { icon: Archive, variant: "secondary" },
};

/** An exam's status as token colour, icon and label together, so colour never carries it alone. */
export function ExamStatusBadge({ status }: { status: ExamStatus }) {
  const t = useTranslations("exams");
  const { icon: Icon, variant } = EXAM_STATUS_STYLE[status];

  return (
    <Badge variant={variant} appearance="light">
      <Icon aria-hidden="true" />
      {t(`status.${status}`)}
    </Badge>
  );
}
