"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { FileText } from "lucide-react";
import type { AuthenticatedUser } from "@schoolhub/types";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services, type WebsitePageDetail } from "@/services";
import { WEBSITE_PAGE_DETAIL_RESOURCE } from "@/services/modules/website/website-pages/website-pages-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { DeletePageDialog } from "./delete-page-dialog";
import { PageEditorHeader } from "./page-editor-header";
import { PageFormDialog } from "./page-form-dialog";
import { useSectionTypeLabel } from "./section-type-label";
import { SectionsPanel } from "./sections-panel";
import { useActiveTheme, type SectionTypes } from "./use-active-theme";
import { useSectionsForm } from "./use-sections-form";

/**
 * One page's editor (`/website/pages/{id}`): its header and actions, then its sections, whose
 * forms come from the active theme's schemas. A page the API can't find (another school's
 * included, ADR-0004) says so, with a way back.
 */
export function PageEditor({ pageId }: { pageId: string }) {
  const t = useTranslations("website.pages");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const theme = useActiveTheme();
  const { data: user } = useCurrentUser();
  const query = useQuery({
    queryKey: queryKeys.detail(WEBSITE_QUERY_MODULE, WEBSITE_PAGE_DETAIL_RESOURCE, pageId),
    queryFn: () => Services.websitePages.fetchWebsitePage(pageId),
  });

  // Waits for the viewer too, so a writer never sees the read-only state flash first.
  if (query.data && theme.sectionTypes && user) {
    return <PageEditorBody page={query.data} types={theme.sectionTypes} user={user} />;
  }

  if (query.error instanceof ApiError && query.error.isNotFound) {
    return (
      <EmptyState
        icon={FileText}
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundDescription")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.WEBSITE_PAGES}>{t("actions.backToList")}</Link>
          </Button>
        }
      />
    );
  }

  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("detail.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  if (theme.error || theme.missing) {
    return (
      <LoadErrorCard
        message={
          theme.missing
            ? t("detail.themeMissing")
            : resolveErrorMessage(theme.error, tErrors, t("detail.themeLoadError"))
        }
        onRetry={theme.refetch}
      />
    );
  }

  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{tCommon("loading")}</span>
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

interface PageEditorBodyProps {
  page: WebsitePageDetail;
  types: SectionTypes;
  user: AuthenticatedUser;
}

function PageEditorBody({ page, types, user }: PageEditorBodyProps) {
  const router = useRouter();
  const editor = useSectionsForm(page, types);
  const labelOf = useSectionTypeLabel(types);
  const [dialog, setDialog] = useState<"details" | "delete" | null>(null);
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const canUpdate = hasPermission(user, "website.page.update");

  return (
    <div className="space-y-5">
      <PageEditorHeader
        page={page}
        canUpdate={canUpdate}
        canPublish={hasPermission(user, "website.page.publish")}
        canDelete={hasPermission(user, "website.page.delete")}
        isDirty={editor.isDirty}
        onEditDetails={() => {
          setDialog("details");
        }}
        onDelete={() => {
          setDialog("delete");
        }}
      />
      <SectionsPanel editor={editor} types={types} labelOf={labelOf} canUpdate={canUpdate} />
      {dialog === "details" && <PageFormDialog open onOpenChange={closeDialog} page={page} />}
      {dialog === "delete" && (
        <DeletePageDialog
          open
          onOpenChange={closeDialog}
          page={page}
          onDeleted={() => {
            router.push(Paths.WEBSITE_PAGES);
          }}
        />
      )}
    </div>
  );
}
