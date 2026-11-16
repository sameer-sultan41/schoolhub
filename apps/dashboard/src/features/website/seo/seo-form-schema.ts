import { z } from "zod";

import type { SeoSettingInput, SeoSettingRecord } from "@/services";
import {
  SEO_CANONICAL_URL_MAX,
  SEO_META_DESCRIPTION_MAX,
  SEO_META_TITLE_MAX,
  SEO_ROBOTS_MAX,
} from "@/services/modules/website/seo-settings/seo-settings-constant";
import { isSafeUrl } from "@/features/website/shared/schema-model";
import type { SchemaMessages } from "@/features/website/shared/schema-zod";

/** The `website.reasons` scope for SEO refusals: its `invalid_url` is the canonical link's. */
export const SEO_REASON_SCOPE = "seo";

/** The inputs a server error can name; a `target_*` refusal is the form's own message. */
export const SEO_FORM_FIELDS = [
  "meta_title",
  "meta_description",
  "og_image_file_id",
  "canonical_url",
  "robots",
] as const;

const text = (messages: SchemaMessages, max: number) =>
  z.string().trim().max(max, messages.tooLong(max));

/**
 * One target's SEO fields, with the API's own bounds (`seo/serializers.py`). The canonical link
 * passes the same `safe-url` check as the server (decision 5a) or is left empty. The image is a
 * file id, or `""` for none. `structured_data` is read-only, so it has no input.
 */
export function seoFormSchema(messages: SchemaMessages) {
  return z.object({
    meta_title: text(messages, SEO_META_TITLE_MAX),
    meta_description: text(messages, SEO_META_DESCRIPTION_MAX),
    og_image_file_id: z.string(),
    canonical_url: text(messages, SEO_CANONICAL_URL_MAX).refine(
      (value) => value === "" || isSafeUrl(value),
      messages.unsafeUrl,
    ),
    robots: text(messages, SEO_ROBOTS_MAX),
  });
}

export type SeoFormValues = z.infer<ReturnType<typeof seoFormSchema>>;

/** The saved values, or empty ones for a target never saved (its text fields arrive as `""`). */
export function seoFormValues(record: SeoSettingRecord): SeoFormValues {
  return {
    meta_title: record.meta_title ?? "",
    meta_description: record.meta_description ?? "",
    og_image_file_id: record.og_image_file_id ?? "",
    canonical_url: record.canonical_url ?? "",
    robots: record.robots ?? "",
  };
}

/** The write body: every field, so a cleared one is cleared; no image is `null`, never `""`. */
export function buildSeoInput(values: SeoFormValues): SeoSettingInput {
  return {
    meta_title: values.meta_title,
    meta_description: values.meta_description,
    og_image_file_id: values.og_image_file_id === "" ? null : values.og_image_file_id,
    canonical_url: values.canonical_url,
    robots: values.robots,
  };
}
