"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { enumLabel } from "@/lib/enum-label";
import type { WebsitePageType } from "@/services";

/** Each page type's label key under `website.pages` (L32). */
const PAGE_TYPE_LABEL_KEY: Readonly<Record<WebsitePageType, string>> = {
  home: "types.home",
  about: "types.about",
  principal_message: "types.principal_message",
  departments: "types.departments",
  teachers: "types.teachers",
  classes: "types.classes",
  admissions: "types.admissions",
  contact: "types.contact",
  standard: "types.standard",
};

/** A page type's name in the viewer's language; one the map doesn't know yet is humanised. */
export function usePageTypeLabel() {
  const t = useTranslations("website.pages");
  return useCallback((type: WebsitePageType) => enumLabel(t, PAGE_TYPE_LABEL_KEY, type), [t]);
}
