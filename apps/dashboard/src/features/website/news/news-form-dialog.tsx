"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Textarea } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { queryKeys } from "@/lib/query-client";
import { Services, type NewsPostDetail } from "@/services";
import {
  NEWS_EXCERPT_MAX,
  NEWS_POSTS_RESOURCE,
} from "@/services/modules/website/news-posts/news-posts-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { useContentFieldMessages } from "@/features/website/shared/content-fields";
import { ContentFormPending } from "@/features/website/shared/content-form-pending";
import { ContentTitleSlugFields } from "@/features/website/shared/content-title-slug-fields";
import { ImageFileField } from "@/features/website/shared/image-file-field";
import { RichTextBlocksField } from "@/features/website/shared/rich-text-blocks-field";
import {
  submitAfterUploads,
  UploadTrackerProvider,
  useUploadTracker,
} from "@/features/website/shared/upload-tracker";
import { useContentFormSubmit } from "@/features/website/shared/use-content-form-submit";
import {
  buildNewsInput,
  NEWS_FORM_FIELDS,
  newsDetailToFormValues,
  newsFormDefaults,
  newsFormSchema,
  type NewsFormValues,
} from "./news-form-schema";

/** The public path a post's slug sits under. */
const NEWS_PATH_PREFIX = "/news/";

export interface NewsFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The post to edit; omitted to write a new one. */
  postId?: string;
}

/** The news post detail's query: the edit dialog and the detail sheet share its cache entry. */
export function useNewsPostDetail(postId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.detail(WEBSITE_QUERY_MODULE, NEWS_POSTS_RESOURCE, postId ?? ""),
    queryFn: () => Services.newsPosts.fetchNewsPost(postId ?? ""),
    enabled: postId !== undefined,
  });
}

/**
 * Writes a news post or edits one: title and address, excerpt, cover image and the rich-text
 * body. An edit waits for the post's detail (the list lacks its body) before the form mounts.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function NewsFormDialog({ open, onOpenChange, postId }: NewsFormDialogProps) {
  const t = useTranslations("website.news");
  const detailQuery = useNewsPostDetail(postId);

  if (postId !== undefined && detailQuery.data === undefined) {
    return (
      <ContentFormPending
        open={open}
        onOpenChange={onOpenChange}
        title={t("form.editTitle")}
        error={detailQuery.error}
        onRetry={() => {
          void detailQuery.refetch();
        }}
      />
    );
  }
  return <NewsForm open={open} onOpenChange={onOpenChange} detail={detailQuery.data} />;
}

function NewsForm({
  open,
  onOpenChange,
  detail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: NewsPostDetail | undefined;
}) {
  const t = useTranslations("website.news");
  const tContent = useTranslations("website.content");
  const tCommon = useTranslations("common");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const tracker = useUploadTracker();
  const messages = useContentFieldMessages();
  const mode = detail ? "edit" : "create";

  const schema = useMemo(() => newsFormSchema(messages), [messages]);
  const form = useForm<NewsFormValues>({
    resolver: zodResolver(schema),
    defaultValues: detail ? newsDetailToFormValues(detail) : newsFormDefaults(),
  });

  const { handleSubmit, formError, isPending } = useContentFormSubmit({
    form,
    save: (values: NewsFormValues) =>
      detail
        ? Services.newsPosts.updateNewsPost(detail.id, buildNewsInput(values, "edit"))
        : Services.newsPosts.createNewsPost(buildNewsInput(values, "create")),
    fields: NEWS_FORM_FIELDS,
    richTextName: "body",
    onSuccess: () => {
      invalidateWebsite();
      toast.success(t(mode === "edit" ? "saved" : "created"));
      onOpenChange(false);
    },
  });

  return (
    <UploadTrackerProvider value={tracker}>
      <FormDialogLayout
        open={open}
        onOpenChange={onOpenChange}
        title={t(mode === "edit" ? "form.editTitle" : "form.createTitle")}
        description={t("form.intro")}
        form={form}
        onSubmit={submitAfterUploads(tracker, handleSubmit)}
        formError={formError}
        isPending={isPending}
        submittingLabel={tCommon("saving")}
        submitDisabled={tracker.isUploading}
      >
        <ContentTitleSlugFields
          form={form}
          pathPrefix={NEWS_PATH_PREFIX}
          autoSlug={mode === "create"}
        />
        <FormField
          control={form.control}
          name="excerpt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.excerpt")}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={2} maxLength={NEWS_EXCERPT_MAX} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <ImageFileField
          key={detail?.id ?? "new"}
          form={form}
          name="cover_image_file_id"
          label={tContent("fields.coverImage")}
        />
        <RichTextBlocksField form={form} name="body" label={t("form.body")} />
      </FormDialogLayout>
    </UploadTrackerProvider>
  );
}
