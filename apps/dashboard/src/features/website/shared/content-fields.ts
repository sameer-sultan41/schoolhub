"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { Regex } from "@/lib/regex";
import { richTextSchema, type RichTextMessages } from "./rich-text";

/**
 * What news posts, events and albums share in their forms: the column limits (mirroring
 * `website_cms/models.py`, which is what enforces them), the title and slug checks, and the
 * translated messages every content form's zod schema takes.
 */

export const CONTENT_TITLE_MAX = 200;
/** `website_cms/constants.py::CONTENT_SLUG_MAX_LENGTH`. */
export const CONTENT_SLUG_MAX = 120;

export interface ContentFieldMessages extends RichTextMessages {
  slug: string;
}

/** The address a title suggests: lowercase letters and digits joined by hyphens, accents
 * dropped; empty for a title with none (an Urdu title), when the slug is typed instead. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(Regex.NON_SLUG_CHARACTERS, "-")
    .replace(Regex.EDGE_HYPHENS, "")
    .slice(0, CONTENT_SLUG_MAX)
    .replace(Regex.EDGE_HYPHENS, "");
}

/** A trimmed text of at most `max` characters; `required` refuses an empty one. */
export function boundedText(messages: ContentFieldMessages, max: number, required = false) {
  const text = z.string().trim().max(max, messages.tooLong(max));
  return required ? text.min(1, messages.required) : text;
}

/** The title, slug and rich-text checks, shaped for a form's `z.object`. */
export function contentFieldSchemas(messages: ContentFieldMessages) {
  return {
    title: boundedText(messages, CONTENT_TITLE_MAX, true),
    slug: boundedText(messages, CONTENT_SLUG_MAX, true).regex(
      Regex.WEBSITE_CONTENT_SLUG,
      messages.slug,
    ),
    richText: richTextSchema(messages),
  };
}

/** The translated messages for `contentFieldSchemas` and the forms built on it. */
export function useContentFieldMessages(): ContentFieldMessages {
  const t = useTranslations("website.content.validation");
  return useMemo(
    () => ({
      required: t("required"),
      tooLong: (max: number) => t("tooLong", { max }),
      imageRequired: t("imageRequired"),
      slug: t("slug"),
    }),
    [t],
  );
}
