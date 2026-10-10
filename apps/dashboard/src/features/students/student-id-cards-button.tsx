"use client";

import { Button } from "@schoolhub/ui";
import { IdCard } from "lucide-react";
import { useTranslations } from "next-intl";

import { useJobFileDownload } from "@/hooks/use-job-file-download";
import { Services } from "@/services";
import { ID_CARDS_FILENAME } from "@/services/modules/students/students-constant";
import type { IdCardJobResult } from "@/services/modules/students/students-type";

/**
 * Batch ID cards for the directory's current-page selection (`POST /id-cards:generate`,
 * one merged PDF). Always mounted while the viewer may generate, so a running job keeps
 * its progress visible after the selection clears or the page changes; hidden only when
 * there is neither a selection nor a job in flight.
 */
export function StudentIdCardsButton({ studentIds }: { studentIds: string[] }) {
  const t = useTranslations("students");
  const idCards = useJobFileDownload<string[]>({
    module: "students",
    start: (ids) => Services.students.generateIdCards(ids),
    filename: ID_CARDS_FILENAME,
    messages: {
      startFailed: t("idCards.startFailed"),
      downloadFailed: t("idCards.downloadFailed"),
      timedOut: t("idCards.timedOut"),
      failed: t("idCards.failed"),
      success: (result) =>
        t("idCards.success", { count: (result as IdCardJobResult | null)?.count ?? 0 }),
    },
  });

  if (studentIds.length === 0 && !idCards.isBusy && !idCards.isStalled) return null;

  return (
    <Button
      variant="outline"
      // `run` never guards against a running job, so busy must block the click here.
      disabled={idCards.isBusy || (studentIds.length === 0 && !idCards.isStalled)}
      onClick={() => {
        idCards.run(studentIds);
      }}
    >
      <IdCard aria-hidden="true" />
      {idCards.isBusy
        ? t("idCards.generating", { progress: idCards.progress })
        : idCards.isStalled
          ? t("idCards.checkStatus")
          : t("idCards.generate", { count: studentIds.length })}
    </Button>
  );
}
