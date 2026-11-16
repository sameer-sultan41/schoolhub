"use client";

import { useTranslations } from "next-intl";

import { DeleteContentDialog } from "@/features/website/shared/delete-content-dialog";
import { Services, type WebsitePageRecord } from "@/services";

export interface DeletePageDialogProps {
  page: WebsitePageRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the page is gone: the editor leaves for the list. */
  onDeleted?: () => void;
}

/**
 * Deletes one page through the shared website delete confirm. The API refuses a published page
 * (`unpublish_first`) and one that is the home page or a menu's link (`page_in_use`); the
 * refusal shows inline, translated, and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeletePageDialog({ page, open, onOpenChange, onDeleted }: DeletePageDialogProps) {
  const t = useTranslations("website.pages");
  return (
    <DeleteContentDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("delete.title", { title: page.title })}
      description={t("delete.description")}
      confirmLabel={t("actions.delete")}
      deletedMessage={t("deleted")}
      remove={() => Services.websitePages.deleteWebsitePage(page.id)}
      onDeleted={onDeleted}
    />
  );
}
