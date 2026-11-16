"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";

import { enumBadge, enumLabel } from "@/lib/enum-label";
import type { WebsiteContentStatus } from "@/services";

/** Each status's label key under `website` (L32); also the status filters' option labels. */
export const CONTENT_STATUS_LABEL_KEY: Readonly<Record<WebsiteContentStatus, string>> = {
  draft: "status.draft",
  published: "status.published",
  archived: "status.archived",
};

const STATUS_BADGE: Readonly<Record<WebsiteContentStatus, "secondary" | "success" | "warning">> = {
  draft: "secondary",
  published: "success",
  archived: "warning",
};

/** A page's, post's, event's or album's status as a theme-token badge with its label. */
export function ContentStatusBadge({ status }: { status: WebsiteContentStatus }) {
  const t = useTranslations("website");
  return (
    <Badge variant={enumBadge(STATUS_BADGE, status, "secondary")} appearance="light">
      {enumLabel(t, CONTENT_STATUS_LABEL_KEY, status)}
    </Badge>
  );
}
