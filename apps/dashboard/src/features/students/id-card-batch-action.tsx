"use client";

import { ApiError } from "@schoolhub/api-client";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useJobPolling } from "@/features/students/use-job-polling";
import { apiClient } from "@/lib/auth";

interface IdCardBatchActionProps {
  selectedIds: string[];
  onDone: () => void;
}

/** Batch ID-card generation from the students list's row selection (module

 * doc §6, §17). Requests the job, then polls it until it either succeeds
 * (offering a download of the merged PDF) or fails.
 */
export function IdCardBatchAction({ selectedIds, onDone }: IdCardBatchActionProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const [jobId, setJobId] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ job_id: string }>("/id-cards:generate", { student_ids: selectedIds }),
    onSuccess: (result) => {
      setJobId(result.data.job_id);
    },
  });

  const jobQuery = useJobPolling(jobId);
  const job = jobQuery.data;

  const downloadMutation = useMutation({
    mutationFn: async (fileId: string) =>
      (await apiClient.post<{ download_url: string }>(`/files/${fileId}:download`)).data,
    onSuccess: (data) => {
      window.open(data.download_url, "_blank", "noopener,noreferrer");
    },
  });

  const mutationError =
    generateMutation.error instanceof ApiError
      ? tErrors.has(generateMutation.error.code)
        ? tErrors(generateMutation.error.code)
        : generateMutation.error.message
      : null;

  if (job?.status === "succeeded") {
    const resultFileId = job.result?.result_file_id;
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={typeof resultFileId !== "string" || downloadMutation.isPending}
          onClick={() => {
            if (typeof resultFileId === "string") downloadMutation.mutate(resultFileId);
          }}
        >
          {t("idCards.download")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setJobId(null);
            onDone();
          }}
        >
          {t("idCards.dismiss")}
        </Button>
      </div>
    );
  }

  if (job?.status === "failed") {
    return (
      <div className="flex items-center gap-2">
        <Alert variant="danger" className="py-2">
          <AlertDescription>{job.error ?? t("idCards.failed")}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setJobId(null);
          }}
        >
          {t("idCards.dismiss")}
        </Button>
      </div>
    );
  }

  if (jobId) {
    return (
      <span className="text-sm text-muted-foreground">
        {t("idCards.generating", { progress: job?.progress ?? 0 })}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {mutationError ? (
        <Alert variant="danger" className="py-2">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        size="sm"
        disabled={selectedIds.length === 0 || generateMutation.isPending}
        onClick={() => {
          generateMutation.mutate();
        }}
      >
        {t("idCards.generate", { count: selectedIds.length })}
      </Button>
    </div>
  );
}
