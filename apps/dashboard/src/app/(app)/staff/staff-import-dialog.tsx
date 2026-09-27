"use client";

import { useEffect, useId, useState, type ChangeEvent } from "react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useJobPolling } from "@/hooks/use-job-polling";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import type { ImportJobResult } from "@/services/modules/jobs/jobs-service";

export interface StaffImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACCEPTED_EXTENSIONS = ".csv,.xlsx";
/** Mirrors `REQUIRED_IMPORT_COLUMNS`/`IMPORT_COLUMNS`
 * (`apps/api/apps/staff_management/staff/services/import_staff.py`) verbatim — shown
 * so the person picking a file knows the header row's exact contract before they
 * upload it. */
const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "staff_type",
  "campus_code",
  "joining_date",
  "phone",
];
const OPTIONAL_COLUMNS = ["gender", "date_of_birth", "email", "national_id"];

/**
 * File picker -> `POST /staff-imports` -> poll -> per-row result. Ported from this
 * app's own earlier `features/staff/import-wizard.tsx` (removed in the unrelated
 * shell-reset commit `9548054`) — same `useTranslations`/error-code-mapping/
 * columns-hint/Table-based result shape, adapted from a full page into a dialog and
 * onto the current `Services.staff`/`useJobPolling` API. Mirrors
 * `exit-staff-dialog.tsx`'s partial-success handling (a succeeded count and a failed
 * count are never mutually exclusive — `import_staff_task` commits each row
 * independently).
 */
export function StaffImportDialog({ open, onOpenChange }: StaffImportDialogProps) {
  const t = useTranslations("staff");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const fileInputId = useId();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const trigger = useMutation({
    mutationFn: (selected: File) => Services.staff.triggerStaffImport(selected),
    onSuccess: (result) => {
      setJobId(result.jobId);
    },
    onError: (error: unknown) => {
      // A field-level detail (e.g. the size-cap check's `{"file": "Import file
      // exceeds..."}`, a real `domain_rule_violation` — `apps/api/apps/
      // staff_management/staff/viewset.py:236-239`) is the useful text; the code's
      // own mapped message ("That action isn't allowed right now.") is deliberately
      // generic because that one code covers many unrelated business rules. Prefer
      // the field detail, then the code mapping, then the raw message — never invent
      // one (Hard Rule 4).
      const message =
        error instanceof ApiError
          ? (error.fieldErrors().file ??
            (tErrors.has(error.code) ? tErrors(error.code) : error.message))
          : t("import.startFailed");
      toast.error(message);
    },
  });

  // `open ? jobId : null` is what actually stops polling on close — `useJobPolling`
  // skips its query the instant this collapses to null, regardless of what `jobId`
  // state still holds.
  const { job, isPolling, isTimedOut, isError } = useJobPolling("staff", open ? jobId : null);
  const result = job?.status === "succeeded" ? (job.result as ImportJobResult | null) : null;
  const hasFinished = job?.status === "succeeded" || job?.status === "failed";
  // True from the moment a job is triggered until it reaches a REAL terminal state —
  // deliberately broader than `isPolling`, which already reads `false` once
  // `isTimedOut`/`isError` flips. Without this, the file input and Upload button
  // re-enable the instant a poll times out or errors, even though the import is still
  // running server-side (or its status is simply unknown) — a re-click there would
  // start a second, redundant import of the same rows rather than actually retrying
  // anything.
  const hasActiveJob = jobId !== null && !hasFinished;

  // Depends only on `job` (plus the stable `queryClient`/`t`) — never on a value
  // derived from `job` inside the body — so `react-hooks/exhaustive-deps` is
  // satisfied without a disable comment. `job`'s reference changes on every poll
  // while running, so this re-runs on each tick, but the status checks below are
  // no-ops until the job actually reaches a terminal state.
  useEffect(() => {
    if (job?.status === "succeeded") {
      const succeededResult = job.result as ImportJobResult | null;
      if (succeededResult && succeededResult.succeeded > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("staff") });
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      }
    }
    if (job?.status === "failed") {
      toast.error(job.error ?? t("import.failed"));
    }
  }, [job, queryClient, t]);

  useEffect(() => {
    if (isTimedOut) {
      toast.error(t("import.timedOut"));
    }
  }, [isTimedOut, t]);

  useEffect(() => {
    if (isError) {
      toast.error(t("import.failed"));
    }
  }, [isError, t]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function handleImportClick() {
    if (file) trigger.mutate(file);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFile(null);
      setJobId(null);
      trigger.reset();
    }
    onOpenChange(next);
  }

  const isBusy = trigger.isPending || hasActiveJob;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeLabel={t("import.close")}>
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("import.description")}</p>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t("import.templateTitle")}</p>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={fileInputId}>{t("import.fields.file")}</Label>
            <Input
              id={fileInputId}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileChange}
              disabled={isBusy}
            />
          </div>

          {isPolling ? (
            <div className="space-y-1.5">
              <Progress value={job?.progress ?? 0} />
              <p className="text-xs text-muted-foreground">
                {t("import.processing", { progress: job?.progress ?? 0 })}
              </p>
            </div>
          ) : null}

          {hasFinished && result ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">
                  {t("import.summarySucceeded", { count: result.succeeded })}
                </Badge>
                {result.failed > 0 ? (
                  <Badge variant="destructive">
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
            </div>
          ) : null}

          {job?.status === "failed" ? (
            <Alert variant="destructive">
              <AlertDescription>{job.error ?? t("import.failed")}</AlertDescription>
            </Alert>
          ) : null}

          {/* Persistent, not just the one-shot toast the effects above already fired —
              a timeout/poll-error state stays true until the user closes the dialog, so
              the reason the file input is still locked needs to stay visible too. */}
          {hasActiveJob && isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t("import.failed")}</AlertDescription>
            </Alert>
          ) : null}
          {hasActiveJob && isTimedOut ? (
            <Alert variant="warning">
              <AlertDescription>{t("import.timedOut")}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
            disabled={trigger.isPending}
          >
            {/* "Cancel" only before any job exists — once one has been triggered, this
                dialog has no real cancel action (the import keeps running server-side
                regardless), so every later state — polling, timed out, errored, or
                finished — reads "Close" instead of a label that implies it stops
                anything. */}
            {jobId === null ? tCommon("cancel") : t("import.close")}
          </Button>
          {jobId === null ? (
            <Button onClick={handleImportClick} disabled={!file || trigger.isPending}>
              {t("import.upload")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
