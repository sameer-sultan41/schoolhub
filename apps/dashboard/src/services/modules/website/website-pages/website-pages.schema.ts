import { z } from "zod";

import { Regex } from "@/lib/regex";
import {
  HOME_PAGE_SLUG,
  PAGE_SLUG_MAX_LENGTH,
  PAGE_TITLE_MAX_LENGTH,
} from "./website-pages-constant";
import type { WebsitePageType } from "./website-pages-type";

/** The page details form (title, address, type, search visibility): snake_case, as the API names
 * them, so a server field error needs no re-keying. */

export interface PageFormMessages {
  required: string;
  tooLong: (max: number) => string;
  slugInvalid: string;
  /** `home` is the home page's address; no other page may take it. */
  slugReserved: string;
}

export interface PageFormValues {
  title: string;
  slug: string;
  page_type: WebsitePageType;
  show_in_search: boolean;
}

/** The form's checks. `isHomePage`: the home page keeps its address, so its slug isn't checked. */
export function createPageFormSchema(messages: PageFormMessages, isHomePage: boolean) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, messages.required)
      .max(PAGE_TITLE_MAX_LENGTH, messages.tooLong(PAGE_TITLE_MAX_LENGTH)),
    slug: z.string().superRefine((value, ctx) => {
      if (isHomePage) return;
      const slug = value.trim();
      if (slug === "") ctx.addIssue({ code: "custom", message: messages.required });
      else if (slug.length > PAGE_SLUG_MAX_LENGTH)
        ctx.addIssue({ code: "custom", message: messages.tooLong(PAGE_SLUG_MAX_LENGTH) });
      else if (!Regex.WEBSITE_PAGE_SLUG.test(slug))
        ctx.addIssue({ code: "custom", message: messages.slugInvalid });
      else if (slug === HOME_PAGE_SLUG)
        ctx.addIssue({ code: "custom", message: messages.slugReserved });
    }),
    page_type: z.custom<WebsitePageType>((value) => typeof value === "string" && value !== ""),
    show_in_search: z.boolean(),
  });
}
