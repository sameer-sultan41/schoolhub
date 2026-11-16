"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { ApiError } from "@/services";
import { FileUploadError } from "@/services/modules/files";

/**
 * A failed website upload in the viewer's language, by the step that failed
 * (`FileUploadError.step`): a refused start shows the server's own reason inside the translated
 * sentence (a type or size limit it names), a failed transfer or confirmation says which. Any
 * other failure is the generic "couldn't be uploaded".
 */
export function useUploadErrorText() {
  const t = useTranslations("website.imageField");
  return useCallback(
    (error: unknown): string => {
      if (!(error instanceof FileUploadError)) return t("uploadFailed");
      if (error.step === "create") {
        return error.cause instanceof ApiError
          ? t("steps.createRefused", { reason: error.message })
          : t("steps.create");
      }
      return t(`steps.${error.step}`);
    },
    [t],
  );
}
