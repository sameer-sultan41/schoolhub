"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { PlatformFormMessages } from "@/services/modules/platform/platform.schema";

/** The console forms' validation messages, translated once and stable across renders, so a
 * dialog's schema memo holds. */
export function usePlatformFormMessages(): PlatformFormMessages {
  const t = useTranslations("platform.validation");
  const tCommon = useTranslations("common");
  return useMemo(
    () => ({
      required: tCommon("requiredField"),
      emailInvalid: t("emailInvalid"),
      slugInvalid: t("slugInvalid"),
      codeInvalid: t("codeInvalid"),
      amountInvalid: t("amountInvalid"),
      currencyInvalid: t("currencyInvalid"),
      wholeNumber: t("wholeNumber"),
    }),
    [t, tCommon],
  );
}
