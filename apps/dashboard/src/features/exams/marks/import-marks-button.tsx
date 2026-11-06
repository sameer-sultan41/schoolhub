"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Upload } from "lucide-react";

import { BulkImportDialog } from "@/components/bulk-import-dialog";
import { Services } from "@/services";
import {
  MARKS_IMPORT_JOB_STORAGE_PREFIX,
  MARKS_IMPORT_OPTIONAL_COLUMNS,
  MARKS_IMPORT_REQUIRED_COLUMNS,
  MARKS_QUERY_MODULE,
} from "@/services/modules/marks/marks-constant";

export interface ImportMarksButtonProps {
  examSubjectId: string;
  /** Named in the title when known (a shared link the progress list doesn't hold has none). */
  subjectName: string | undefined;
}

/**
 * Import a marks sheet (CSV or .xlsx) for one exam-subject, through the shared
 * `BulkImportDialog`: the server checks each row's section against the importer's, so one sheet
 * may cover every section they enter. The caller shows this to a holder of `exams.marks.import`.
 * A job is remembered per exam-subject, so another subject's dialog never picks it up.
 */
export function ImportMarksButton({ examSubjectId, subjectName }: ImportMarksButtonProps) {
  const t = useTranslations("exams");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Upload aria-hidden="true" />
        {t("marks.import.button")}
      </Button>
      <BulkImportDialog
        open={open}
        onOpenChange={setOpen}
        module={MARKS_QUERY_MODULE}
        title={
          subjectName === undefined
            ? t("marks.import.titleFallback")
            : t("marks.import.title", { subject: subjectName })
        }
        description={t("marks.import.description")}
        requiredColumns={MARKS_IMPORT_REQUIRED_COLUMNS}
        optionalColumns={MARKS_IMPORT_OPTIONAL_COLUMNS}
        storageKeyPrefix={`${MARKS_IMPORT_JOB_STORAGE_PREFIX}${examSubjectId}:`}
        start={(file) => Services.marks.importMarks(examSubjectId, file)}
      />
    </>
  );
}
