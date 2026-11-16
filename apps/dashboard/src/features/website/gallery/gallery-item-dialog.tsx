"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useContentFieldMessages } from "@/features/website/shared/content-fields";
import { useContentFormSubmit } from "@/features/website/shared/use-content-form-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type GalleryItemRecord } from "@/services";
import {
  GALLERY_ALT_TEXT_MAX,
  GALLERY_CAPTION_MAX,
  GALLERY_EMBED_URL_MAX,
  GALLERY_MEDIA_VIDEO,
} from "@/services/modules/website/gallery-albums/gallery-albums-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import {
  buildGalleryItemInput,
  GALLERY_ITEM_FORM_FIELDS,
  galleryItemFormValues,
  galleryItemSchema,
  type GalleryItemFormValues,
} from "./gallery-item-schema";

/** The text inputs, in display order: name, label key, hint key, column length. */
const TEXT_FIELDS = [
  ["embed_url", "embedUrl", "embedUrlHint", GALLERY_EMBED_URL_MAX],
  ["caption", "caption", null, GALLERY_CAPTION_MAX],
  ["alt_text", "altText", "altTextHint", GALLERY_ALT_TEXT_MAX],
] as const;

export interface GalleryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  albumId: string;
  /** The item to edit; omitted to add a video. */
  item?: GalleryItemRecord;
}

/**
 * Adds a video to an album, or edits an item's caption and description (and a video's link).
 * A photo's file is chosen by uploading, not here. A link the server refuses (`invalid_url`,
 * `embed_host_not_allowed`) shows under the link, in the viewer's language.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function GalleryItemDialog({ open, onOpenChange, albumId, item }: GalleryItemDialogProps) {
  const t = useTranslations("website.gallery.items.form");
  const tReasons = useTranslations("website.reasons");
  const tCommon = useTranslations("common");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const fieldMessages = useContentFieldMessages();

  const schema = useMemo(
    () =>
      galleryItemSchema({
        ...fieldMessages,
        altRequired: fieldMessages.required,
        embedRequired: tReasons("embed_required"),
        embedHttps: tReasons("invalid_url"),
      }),
    [fieldMessages, tReasons],
  );
  const form = useForm<GalleryItemFormValues>({
    resolver: zodResolver(schema),
    defaultValues: galleryItemFormValues(item),
  });
  const isVideo = form.getValues("media_type") === GALLERY_MEDIA_VIDEO;

  const { handleSubmit, formError, isPending } = useContentFormSubmit({
    form,
    save: (values: GalleryItemFormValues) => {
      const input = buildGalleryItemInput(values);
      return item
        ? Services.galleryAlbums.updateGalleryItem(albumId, item.id, input)
        : Services.galleryAlbums.createGalleryItem(albumId, input);
    },
    fields: GALLERY_ITEM_FORM_FIELDS,
    onSuccess: () => {
      invalidateWebsite();
      toast.success(t(item ? "saved" : "added"));
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t(item ? "editTitle" : "videoTitle")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      {TEXT_FIELDS.filter(([name]) => isVideo || name !== "embed_url").map(
        ([name, labelKey, hintKey, max]) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(labelKey)}</FormLabel>
                <FormControl required={name === "embed_url" || (!isVideo && name === "alt_text")}>
                  <Input
                    {...field}
                    maxLength={max}
                    {...(name === "embed_url" ? { type: "url", dir: "ltr" } : {})}
                  />
                </FormControl>
                {/* A photo's description hint; a video shows only its link's. */}
                {hintKey && (!isVideo || name === "embed_url") ? (
                  <FormDescription>{t(hintKey)}</FormDescription>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />
        ),
      )}
    </FormDialogLayout>
  );
}
