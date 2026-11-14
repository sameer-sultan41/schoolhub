"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { Archive, CircleCheck, PencilLine, type LucideIcon } from "lucide-react";

import { enumBadge, enumLabel } from "@/lib/enum-label";
import type { FeeStructureStatus } from "@/services";
import { STRUCTURE_STATUS_LABEL_KEY } from "./fee-setup-labels";

const STATUS_ICON: Record<FeeStructureStatus, LucideIcon> = {
  draft: PencilLine,
  active: CircleCheck,
  archived: Archive,
};

const STATUS_VARIANT: Record<FeeStructureStatus, "warning" | "success" | "secondary"> = {
  draft: "warning",
  active: "success",
  archived: "secondary",
};

/** A structure's status as token, icon and label together (`fees.structures.status.*`). */
export function StructureStatusBadge({ status }: { status: FeeStructureStatus }) {
  const t = useTranslations("fees");
  const Icon = status in STATUS_ICON ? STATUS_ICON[status] : PencilLine;
  return (
    <Badge variant={enumBadge(STATUS_VARIANT, status, "secondary")} appearance="light">
      <Icon aria-hidden="true" />
      {enumLabel(t, STRUCTURE_STATUS_LABEL_KEY, status)}
    </Badge>
  );
}
