"use client";

import { useTranslations } from "next-intl";
import { Badge, BadgeDot } from "@schoolhub/ui";

import { PORTAL_STATUS_VARIANT } from "@/services/modules/students/students-constant";
import type { PortalStatus } from "@/services/modules/students/students-type";

/** A student's or guardian's portal account state, labelled through the `students.portal.status` map (L32). */
export function PortalStatusBadge({ status }: { status: PortalStatus }) {
  const t = useTranslations("students.portal");
  return (
    <Badge size="sm" variant={PORTAL_STATUS_VARIANT[status]} appearance="light" shape="circle">
      <BadgeDot />
      {t(`status.${status}`)}
    </Badge>
  );
}
