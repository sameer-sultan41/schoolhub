"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { StructureFormMessages } from "@/services/modules/school-organization/school-organization.schema";

/** The structure forms' validation messages, translated once and stable across renders, so a
 * dialog's schema memo holds. */
export function useStructureFormMessages(): StructureFormMessages {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  return useMemo(
    () => ({
      required: tCommon("requiredField"),
      emailInvalid: t("form.emailInvalid"),
      colorInvalid: t("form.colorInvalid"),
      endBeforeStart: t("calendar.form.endBeforeStart"),
    }),
    [t, tCommon],
  );
}
