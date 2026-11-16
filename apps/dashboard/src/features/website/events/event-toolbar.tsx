"use client";

import { useTranslations } from "next-intl";

import { ContentToolbar } from "@/features/website/shared/content-toolbar";
import { EventFormDialog } from "./event-form-dialog";

/** The Events heading and "New event" (`website.school-event.create`). */
export function EventToolbar() {
  const t = useTranslations("website.events");
  return (
    <ContentToolbar
      title={t("title")}
      description={t("summary")}
      createLabel={t("actions.create")}
      createPermission="website.school-event.create"
      renderCreateDialog={(onOpenChange) => <EventFormDialog open onOpenChange={onOpenChange} />}
    />
  );
}
