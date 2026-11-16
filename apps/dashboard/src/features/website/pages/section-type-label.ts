"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { humanizeSnakeCase } from "@/lib/helpers";
import type { SectionTypes } from "./use-active-theme";

/** A section type's name in the viewer's language; a type with no translation shows the theme's
 * own label, else its humanised code. */
export function useSectionTypeLabel(types: SectionTypes) {
  const t = useTranslations("website.pages.sectionTypes");
  return useCallback(
    (type: string) => (t.has(type) ? t(type) : (types[type]?.label ?? humanizeSnakeCase(type))),
    [t, types],
  );
}
