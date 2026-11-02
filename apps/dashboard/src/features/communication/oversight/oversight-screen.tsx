"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert } from "@schoolhub/ui";

import { OVERSIGHT_SOURCE } from "@/features/communication/messages/thread-source";
import { ThreadPanes } from "@/features/communication/messages/thread-panes";

/** Every conversation in the school, read-only; the same list and thread view as the inbox. */
export function OversightScreen() {
  const t = useTranslations("communication.oversight");

  return (
    <ThreadPanes
      source={OVERSIGHT_SOURCE}
      readOnly
      header={
        <Alert variant="info">
          <ShieldCheck aria-hidden="true" />
          {t("auditBanner")}
        </Alert>
      }
    />
  );
}
