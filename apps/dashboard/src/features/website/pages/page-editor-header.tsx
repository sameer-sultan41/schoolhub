"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import { Services, type WebsitePageDetail } from "@/services";
import { HOME_PAGE_TYPE } from "@/services/modules/website/website-pages/website-pages-constant";
import { pagePublicPath } from "@/services/modules/website/website-pages/website-pages-helper";
import { ContentStatusBadge } from "@/features/website/shared/content-status-badge";
import { PublishActions } from "@/features/website/shared/publish-actions";
import { usePageTypeLabel } from "./page-type-label";
import { PreviewPageButton } from "./preview-page-button";

export interface PageEditorHeaderProps {
  page: WebsitePageDetail;
  canUpdate: boolean;
  canPublish: boolean;
  canDelete: boolean;
  /** The sections have unsaved edits: Publish would publish the saved version, so it waits. */
  isDirty: boolean;
  onEditDetails: () => void;
  onDelete: () => void;
}

/**
 * The page's title, address, type and status, with its actions: details, preview, the publish
 * workflow and delete. Publish waits for a saved, visible section (the API refuses a page
 * with none, `no_visible_sections`) and says why. Delete is offered only where the API could
 * allow it: never on the home page, and only once unpublished.
 */
export function PageEditorHeader({
  page,
  canUpdate,
  canPublish,
  canDelete,
  isDirty,
  onEditDetails,
  onDelete,
}: PageEditorHeaderProps) {
  const t = useTranslations("website.pages");
  const typeLabel = usePageTypeLabel();
  const hasVisibleSection = page.sections.some((section) => section.is_visible);
  const publishHold =
    page.status === "published"
      ? null
      : isDirty
        ? t("editor.publishNeedsSave")
        : hasVisibleSection
          ? null
          : t("editor.publishNeedsVisible");
  const isHomePage = page.page_type === HOME_PAGE_TYPE;
  const deletable = canDelete && page.status !== "published" && !isHomePage;

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" asChild>
        <Link href={Paths.WEBSITE_PAGES}>
          <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
          {t("actions.backToList")}
        </Link>
      </Button>
      <Toolbar>
        <div className="space-y-1.5">
          <ToolbarHeading
            title={page.title}
            description={t("editor.summary", {
              path: pagePublicPath(page),
              type: typeLabel(page.page_type),
            })}
          />
          <ContentStatusBadge status={page.status} />
        </div>
        <ToolbarActions>
          {canUpdate ? (
            <Button variant="outline" onClick={onEditDetails}>
              <Pencil aria-hidden="true" />
              {t("actions.editDetails")}
            </Button>
          ) : null}
          <PreviewPageButton pageId={page.id} />
          <PublishActions
            status={page.status}
            canPublish={canPublish}
            publishDisabled={publishHold !== null}
            publish={() => Services.websitePages.publishWebsitePage(page.id)}
            unpublish={() => Services.websitePages.unpublishWebsitePage(page.id)}
            // The home page can't go away (`page_in_use`), so it is never offered Archive.
            archive={
              isHomePage ? undefined : () => Services.websitePages.archiveWebsitePage(page.id)
            }
          />
          {deletable ? (
            <Button variant="outline-danger" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              {t("actions.delete")}
            </Button>
          ) : null}
        </ToolbarActions>
      </Toolbar>
      {canPublish && publishHold ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {publishHold}
        </p>
      ) : null}
    </div>
  );
}
