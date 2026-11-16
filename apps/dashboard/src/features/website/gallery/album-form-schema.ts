import { z } from "zod";

import {
  contentFieldSchemas,
  type ContentFieldMessages,
} from "@/features/website/shared/content-fields";
import type { GalleryAlbumInput, GalleryAlbumRecord } from "@/services";

/** The album form, with the API's own field names. `cover_image_file_id` is `""` for none. */
export function albumFormSchema(messages: ContentFieldMessages) {
  const fields = contentFieldSchemas(messages);
  return z.object({
    title: fields.title,
    slug: fields.slug,
    description: z.string().trim(),
    cover_image_file_id: z.string(),
  });
}

export type AlbumFormValues = z.infer<ReturnType<typeof albumFormSchema>>;

/** The inputs a server error can name. */
export const ALBUM_FORM_FIELDS = ["title", "slug", "description", "cover_image_file_id"];

export function albumFormDefaults(): AlbumFormValues {
  return { title: "", slug: "", description: "", cover_image_file_id: "" };
}

export function albumToFormValues(album: GalleryAlbumRecord): AlbumFormValues {
  return {
    title: album.title,
    slug: album.slug,
    description: album.description,
    cover_image_file_id: album.cover_image_file_id ?? "",
  };
}

/** The create or update body. No cover is an omitted key on create and `null` on edit. */
export function buildAlbumInput(
  values: AlbumFormValues,
  mode: "create" | "edit",
): GalleryAlbumInput {
  const input: GalleryAlbumInput = {
    title: values.title,
    slug: values.slug,
    description: values.description,
  };
  if (values.cover_image_file_id) input.cover_image_file_id = values.cover_image_file_id;
  else if (mode === "edit") input.cover_image_file_id = null;
  return input;
}
