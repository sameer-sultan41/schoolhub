"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";

import { enumBadge, enumLabel } from "@/lib/enum-label";
import type { ContactSubmissionStatus } from "@/services";

/** Each triage status's label key under `website.inbox` (L32); also the filter's option labels. */
export const CONTACT_STATUS_LABEL_KEY: Readonly<Record<ContactSubmissionStatus, string>> = {
  new: "status.new",
  read: "status.read",
  responded: "status.responded",
  spam: "status.spam",
};

const STATUS_BADGE: Readonly<
  Record<ContactSubmissionStatus, "primary" | "secondary" | "success" | "warning">
> = {
  new: "primary",
  read: "secondary",
  responded: "success",
  spam: "warning",
};

/** A contact message's triage status as a theme-token badge. */
export function ContactStatusBadge({ status }: { status: ContactSubmissionStatus }) {
  const t = useTranslations("website.inbox");
  return (
    <Badge variant={enumBadge(STATUS_BADGE, status, "secondary")} appearance="light">
      {enumLabel(t, CONTACT_STATUS_LABEL_KEY, status)}
    </Badge>
  );
}
