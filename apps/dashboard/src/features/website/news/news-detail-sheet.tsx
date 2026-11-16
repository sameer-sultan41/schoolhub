"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import { Services } from "@/services";
import { ContentDetailSheet, ContentFact } from "@/features/website/shared/content-detail-sheet";
import { PublishActions } from "@/features/website/shared/publish-actions";
import { SeoButton } from "@/features/website/seo/seo-button";
import { useNewsPostDetail } from "./news-form-dialog";

export interface NewsPermissions {
  canUpdate: boolean;
  canPublish: boolean;
  canDelete: boolean;
}

export interface NewsDetailSheetProps {
  postId: string;
  onOpenChange: (open: boolean) => void;
  permissions: NewsPermissions;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * A news post in full, with its actions: Edit, Publish / Unpublish / Archive by its status, SEO,
 * and Delete, which the server allows only once the post is not published (`unpublish_first`), so it
 * is offered only then. Each action follows its own key.
 */
export function NewsDetailSheet({
  postId,
  onOpenChange,
  permissions,
  onEdit,
  onDelete,
}: NewsDetailSheetProps) {
  const t = useTranslations("website.news");
  const tContent = useTranslations("website.content");
  const locale = useLocale();
  const query = useNewsPostDetail(postId);
  const post = query.data;

  return (
    <ContentDetailSheet
      open
      onOpenChange={onOpenChange}
      detail={
        post && {
          title: post.title,
          status: post.status,
          updatedAt: post.updated_at,
          richText: post.body,
        }
      }
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      richTextLabel={t("form.body")}
      facts={
        post && (
          <>
            <ContentFact label={tContent("fields.slug")}>
              <span dir="ltr">{`/news/${post.slug}`}</span>
            </ContentFact>
            <ContentFact label={t("columns.publishedAt")}>
              {post.published_at ? formatDate(post.published_at, locale) : EMPTY_VALUE}
            </ContentFact>
            <ContentFact label={tContent("fields.coverImage")}>
              {post.cover_image_file_id ? tContent("imageOnFile") : EMPTY_VALUE}
            </ContentFact>
            <ContentFact label={t("form.excerpt")} wide>
              {post.excerpt || EMPTY_VALUE}
            </ContentFact>
          </>
        )
      }
      footer={
        post && (
          <>
            {permissions.canUpdate && (
              <Button variant="outline" onClick={onEdit}>
                {t("actions.edit")}
              </Button>
            )}
            <PublishActions
              status={post.status}
              canPublish={permissions.canPublish}
              publish={() => Services.newsPosts.publishNewsPost(post.id)}
              unpublish={() => Services.newsPosts.unpublishNewsPost(post.id)}
              archive={() => Services.newsPosts.archiveNewsPost(post.id)}
            />
            <SeoButton target={{ targetType: "news_post", targetId: post.id }} title={post.title} />
            {permissions.canDelete && post.status !== "published" && (
              <Button variant="destructive" appearance="light" onClick={onDelete}>
                {tContent("delete")}
              </Button>
            )}
          </>
        )
      }
    />
  );
}
