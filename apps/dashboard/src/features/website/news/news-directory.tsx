"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Newspaper } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type NewsPostRecord } from "@/services";
import {
  NEWS_POSTS_RESOURCE,
  NEWS_SORT_FIELD,
} from "@/services/modules/website/news-posts/news-posts-constant";
import { ContentDirectoryCard } from "@/features/website/shared/content-directory-card";
import { CONTENT_REASON_SCOPE } from "@/features/website/shared/content-fields";
import { DeleteContentDialog } from "@/features/website/shared/delete-content-dialog";
import { useContentDirectory } from "@/features/website/shared/use-content-directory";
import { useNewsColumns } from "./news-columns";
import { NewsDetailSheet } from "./news-detail-sheet";
import { NewsFormDialog } from "./news-form-dialog";

type Target = { post: NewsPostRecord; action: "view" | "edit" | "delete" };

/**
 * The `/website/news` directory: every post, searched and filtered by status, server
 * paginated, with the view state in the URL. A title opens the detail sheet (the lifecycle and
 * Delete); Edit is the row's own. Each dialog and the sheet are mounted only while open.
 */
export function NewsDirectory() {
  const t = useTranslations("website.news");
  const { data: user } = useCurrentUser();
  const permissions = {
    canUpdate: hasPermission(user, "website.news-post.update"),
    canPublish: hasPermission(user, "website.news-post.publish"),
    canDelete: hasPermission(user, "website.news-post.delete"),
  };
  const [target, setTarget] = useState<Target | null>(null);

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleOpen = useCallback((post: NewsPostRecord) => {
    setTarget({ post, action: "view" });
  }, []);
  const handleEdit = useCallback((post: NewsPostRecord) => {
    setTarget({ post, action: "edit" });
  }, []);

  const columns = useNewsColumns({
    canUpdate: permissions.canUpdate,
    canPublish: permissions.canPublish,
    onOpen: handleOpen,
    onEdit: handleEdit,
  });
  const directory = useContentDirectory({
    columns,
    resource: NEWS_POSTS_RESOURCE,
    sortField: NEWS_SORT_FIELD,
    fetchPage: Services.newsPosts.fetchNewsPostPage,
  });

  const close = (open: boolean) => {
    if (!open) setTarget(null);
  };

  return (
    <ContentDirectoryCard
      directory={directory}
      icon={Newspaper}
      labels={{
        caption: t("list.caption"),
        searchPlaceholder: t("list.searchPlaceholder"),
        loadError: t("list.loadError"),
        emptyTitle: t("list.emptyTitle"),
        emptyDescription: t("list.emptyDescription"),
      }}
    >
      {target?.action === "view" && (
        <NewsDetailSheet
          postId={target.post.id}
          onOpenChange={close}
          permissions={permissions}
          onEdit={() => {
            setTarget({ post: target.post, action: "edit" });
          }}
          onDelete={() => {
            setTarget({ post: target.post, action: "delete" });
          }}
        />
      )}
      {target?.action === "edit" && (
        <NewsFormDialog open onOpenChange={close} postId={target.post.id} />
      )}
      {target?.action === "delete" && (
        <DeleteContentDialog
          open
          onOpenChange={close}
          title={t("delete.title", { title: target.post.title })}
          description={t("delete.description")}
          remove={() => Services.newsPosts.deleteNewsPost(target.post.id)}
          reasonScope={CONTENT_REASON_SCOPE}
        />
      )}
    </ContentDirectoryCard>
  );
}
