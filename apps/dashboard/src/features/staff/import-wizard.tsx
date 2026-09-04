"use client";

import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { ImportResult } from "@/features/students/job-types";
import { useJobPolling } from "@/hooks/use-job-polling";
import { apiClient } from "@/lib/auth";

const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "staff_type",
  "campus_code",
  "phone",
  "joining_date",
];
const OPTIONAL_COLUMNS = [
  "gender",
  "date_of_birth",
  "department_code",
  "designation_code",
  "employment_type",
  "email",
  "national_id",
];

export function ImportWizard() {
  const t = useTranslations("staff");
  const tErrors = useTranslations("errors");
  const fileInputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("no file selected");
      const formData = new FormData();
      formData.append("file", file);
      return apiClient.post<{ job_id: string }>("/staff-imports", formData);
    },
    onSuccess: (result) => {
      setJobId(result.data.job_id);
    },
  });

  const jobQuery = useJobPolling("staff", jobId);
  const job = jobQuery.data;
  const result = job?.result as ImportResult | null | undefined;

  const mutationError =
    uploadMutation.error instanceof ApiError
      ? tErrors.has(uploadMutation.error.code)
        ? tErrors(uploadMutation.error.code)
        : uploadMutation.error.message
      : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-sm font-medium text-foreground">{t("import.templateTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("import.templateHint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {REQUIRED_COLUMNS.map((column) => (
              <Badge key={column}>{column}</Badge>
            ))}
            {OPTIONAL_COLUMNS.map((column) => (
              <Badge key={column} variant="outline">
                {column}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {!jobId ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {mutationError ? (
              <Alert variant="danger">
                <AlertDescription>{mutationError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={fileInputId}>{t("import.fields.file")}</Label>
              <Input
                id={fileInputId}
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                }}
              />
            </div>
            <Button
              disabled={!file || uploadMutation.isPending}
              onClick={() => {
                uploadMutation.mutate();
              }}
            >
              {t("import.upload")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {jobId && job?.status !== "succeeded" && job?.status !== "failed" ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t("import.processing", { progress: job?.progress ?? 0 })}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {job?.status === "failed" ? (
        <Alert variant="danger">
          <AlertDescription>{job.error ?? t("import.failed")}</AlertDescription>
        </Alert>
      ) : null}

      {job?.status === "succeeded" && result ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">
                {t("import.summarySucceeded", { count: result.succeeded })}
              </Badge>
              {result.failed > 0 ? (
                <Badge variant="danger">
                  {t("import.summaryFailed", { count: result.failed })}
                </Badge>
              ) : null}
            </div>

            {result.errors.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("import.errorTable.row")}</TableHead>
                      <TableHead>{t("import.errorTable.field")}</TableHead>
                      <TableHead>{t("import.errorTable.issue")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((rowError, index) => (
                      <TableRow key={`${rowError.row}-${index}`}>
                        <TableCell className="tabular-nums">{rowError.row}</TableCell>
                        <TableCell>{rowError.field}</TableCell>
                        <TableCell>{rowError.issue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setJobId(null);
                setFile(null);
                uploadMutation.reset();
              }}
            >
              {t("import.importAnother")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
