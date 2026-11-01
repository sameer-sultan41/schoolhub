"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";

import type { MessageThreadStatus } from "@/services/modules/message-threads/message-threads-type";

/** A thread's status: open is positive, closed is neutral. */
export function ThreadStatusBadge({ status }: { status: MessageThreadStatus }) {
  const t = useTranslations("communication.messages.status");
  return (
    <Badge size="sm" appearance="light" variant={status === "open" ? "success" : "secondary"}>
      {t(status)}
    </Badge>
  );
}
