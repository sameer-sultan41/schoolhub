import { z } from "zod";

import { boundedText, type ContentFieldMessages } from "@/features/website/shared/content-fields";
import type { GalleryItemInput, GalleryItemRecord } from "@/services";
import {
  GALLERY_ALT_TEXT_MAX,
  GALLERY_CAPTION_MAX,
  GALLERY_EMBED_URL_MAX,
  GALLERY_MEDIA_IMAGE,
  GALLERY_MEDIA_VIDEO,
} from "@/services/modules/website/gallery-albums/gallery-albums-constant";

/** The only scheme an embed may use (`item_services.py::_validate_item`). */
const HTTPS_PREFIX = "https://";

export interface GalleryItemMessages extends ContentFieldMessages {
  altRequired: string;
  embedRequired: string;
  embedHttps: string;
}

/**
 * A photo's caption and description, or a video's link, caption and description. A photo's
 * description is required here for screen-reader users; the API stores it but does not demand
 * it. A video link must be `https://` and within the column's length; which hosts are allowed
 * is the server's list alone (`embed_host_not_allowed` lands under the link).
 */
export function galleryItemSchema(messages: GalleryItemMessages) {
  return z
    .object({
      media_type: z.enum([GALLERY_MEDIA_IMAGE, GALLERY_MEDIA_VIDEO]),
      embed_url: boundedText(messages, GALLERY_EMBED_URL_MAX),
      caption: boundedText(messages, GALLERY_CAPTION_MAX),
      alt_text: boundedText(messages, GALLERY_ALT_TEXT_MAX),
    })
    .superRefine((values, ctx) => {
      if (values.media_type === GALLERY_MEDIA_IMAGE) {
        if (values.alt_text === "") {
          ctx.addIssue({ code: "custom", path: ["alt_text"], message: messages.altRequired });
        }
        return;
      }
      if (values.embed_url === "") {
        ctx.addIssue({ code: "custom", path: ["embed_url"], message: messages.embedRequired });
      } else if (!values.embed_url.startsWith(HTTPS_PREFIX)) {
        ctx.addIssue({ code: "custom", path: ["embed_url"], message: messages.embedHttps });
      }
    });
}

export type GalleryItemFormValues = z.infer<ReturnType<typeof galleryItemSchema>>;

/** The inputs a server error can name; `file_id` and `position` refusals are the form's own. */
export const GALLERY_ITEM_FORM_FIELDS = ["embed_url", "caption", "alt_text"];

export function galleryItemFormValues(item?: GalleryItemRecord): GalleryItemFormValues {
  return {
    media_type: item?.media_type ?? GALLERY_MEDIA_VIDEO,
    embed_url: item?.embed_url ?? "",
    caption: item?.caption ?? "",
    alt_text: item?.alt_text ?? "",
  };
}

/** The write body: a photo's file stays as it is, so only its texts are sent. */
export function buildGalleryItemInput(values: GalleryItemFormValues): GalleryItemInput {
  const input: GalleryItemInput = { caption: values.caption, alt_text: values.alt_text };
  if (values.media_type === GALLERY_MEDIA_VIDEO) {
    input.media_type = GALLERY_MEDIA_VIDEO;
    input.embed_url = values.embed_url;
  }
  return input;
}
