import { z } from "zod";

import type { NewsPostDetail, NewsPostInput } from "@/services";
import { NEWS_EXCERPT_MAX } from "@/services/modules/website/news-posts/news-posts-constant";
import {
  boundedText,
  contentFieldSchemas,
  type ContentFieldMessages,
} from "@/features/website/shared/content-fields";
import { emptyRichText, toRichText, toRichTextPayload } from "@/features/website/shared/rich-text";

/** The news post form, with the API's own field names. `cover_image_file_id` is `""` for none. */
export function newsFormSchema(messages: ContentFieldMessages) {
  const fields = contentFieldSchemas(messages);
  return z.object({
    title: fields.title,
    slug: fields.slug,
    excerpt: boundedText(messages, NEWS_EXCERPT_MAX),
    cover_image_file_id: z.string(),
    body: fields.richText,
  });
}

export type NewsFormValues = z.infer<ReturnType<typeof newsFormSchema>>;

/** The inputs a server error can name; a body error is mapped by its block path. */
export const NEWS_FORM_FIELDS = ["title", "slug", "excerpt", "cover_image_file_id", "body"];

export function newsFormDefaults(): NewsFormValues {
  return { title: "", slug: "", excerpt: "", cover_image_file_id: "", body: emptyRichText() };
}

export function newsDetailToFormValues(detail: NewsPostDetail): NewsFormValues {
  return {
    title: detail.title,
    slug: detail.slug,
    excerpt: detail.excerpt,
    cover_image_file_id: detail.cover_image_file_id ?? "",
    body: toRichText(detail.body),
  };
}

/**
 * The create or update body. No cover is an omitted key on create (the API refuses an empty id)
 * and `null` on edit, which clears the saved one.
 */
export function buildNewsInput(values: NewsFormValues, mode: "create" | "edit"): NewsPostInput {
  const input: NewsPostInput = {
    title: values.title,
    slug: values.slug,
    excerpt: values.excerpt,
    body: toRichTextPayload(toRichText(values.body)),
  };
  if (values.cover_image_file_id) input.cover_image_file_id = values.cover_image_file_id;
  else if (mode === "edit") input.cover_image_file_id = null;
  return input;
}
