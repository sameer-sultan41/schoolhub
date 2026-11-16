"use client";

import { useTranslations } from "next-intl";

import { ContentToolbar } from "@/features/website/shared/content-toolbar";
import { NewsFormDialog } from "./news-form-dialog";

/** The News heading and "New post" (`website.news-post.create`). */
export function NewsToolbar() {
  const t = useTranslations("website.news");
  return (
    <ContentToolbar
      title={t("title")}
      description={t("summary")}
      createLabel={t("actions.create")}
      createPermission="website.news-post.create"
      renderCreateDialog={(onOpenChange) => <NewsFormDialog open onOpenChange={onOpenChange} />}
    />
  );
}
