"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Textarea } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useContentFieldMessages } from "@/features/website/shared/content-fields";
import { ContentTitleSlugFields } from "@/features/website/shared/content-title-slug-fields";
import { ImageFileField } from "@/features/website/shared/image-file-field";
import {
  submitAfterUploads,
  UploadTrackerProvider,
  useUploadTracker,
} from "@/features/website/shared/upload-tracker";
import { useContentFormSubmit } from "@/features/website/shared/use-content-form-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type GalleryAlbumRecord } from "@/services";
import { GALLERY_PATH_PREFIX } from "@/services/modules/website/gallery-albums/gallery-albums-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import {
  ALBUM_FORM_FIELDS,
  albumFormDefaults,
  albumFormSchema,
  albumToFormValues,
  buildAlbumInput,
  type AlbumFormValues,
} from "./album-form-schema";

export interface AlbumFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The album to edit (the list's record holds every field); omitted to create one. */
  album?: GalleryAlbumRecord;
  /** After a create, e.g. to open the new album's page. */
  onCreated?: (album: GalleryAlbumRecord) => void;
}

/**
 * Creates an album or edits its title, address, description and cover. Its photos and videos
 * are managed on the album's own page.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function AlbumFormDialog({ open, onOpenChange, album, onCreated }: AlbumFormDialogProps) {
  const t = useTranslations("website.gallery");
  const tContent = useTranslations("website.content");
  const tCommon = useTranslations("common");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const tracker = useUploadTracker();
  const messages = useContentFieldMessages();

  const schema = useMemo(() => albumFormSchema(messages), [messages]);
  const form = useForm<AlbumFormValues>({
    resolver: zodResolver(schema),
    defaultValues: album ? albumToFormValues(album) : albumFormDefaults(),
  });

  const { handleSubmit, formError, isPending } = useContentFormSubmit({
    form,
    save: (values: AlbumFormValues) =>
      album
        ? Services.galleryAlbums.updateGalleryAlbum(album.id, buildAlbumInput(values, "edit"))
        : Services.galleryAlbums.createGalleryAlbum(buildAlbumInput(values, "create")),
    fields: ALBUM_FORM_FIELDS,
    onSuccess: (saved) => {
      invalidateWebsite();
      toast.success(t(album ? "saved" : "created"));
      onOpenChange(false);
      if (!album) onCreated?.(saved);
    },
  });

  return (
    <UploadTrackerProvider value={tracker}>
      <FormDialogLayout
        open={open}
        onOpenChange={onOpenChange}
        title={t(album ? "form.editTitle" : "form.createTitle")}
        description={t("form.intro")}
        form={form}
        onSubmit={submitAfterUploads(tracker, handleSubmit)}
        formError={formError}
        isPending={isPending}
        submittingLabel={tCommon("saving")}
        submitDisabled={tracker.isUploading}
      >
        <ContentTitleSlugFields form={form} pathPrefix={GALLERY_PATH_PREFIX} autoSlug={!album} />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("form.description")}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <ImageFileField
          key={album?.id ?? "new"}
          form={form}
          name="cover_image_file_id"
          label={tContent("fields.coverImage")}
        />
      </FormDialogLayout>
    </UploadTrackerProvider>
  );
}
