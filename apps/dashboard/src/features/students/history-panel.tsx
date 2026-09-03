"use client";

import { ApiError, collectPages } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@schoolhub/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Can } from "@/components/can";
import type {
  HistoryEvent,
  StudentTransferRecord,
  TransferType,
} from "@/features/students/enrollment-types";
import { useCampuses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const TRANSFER_TYPES: TransferType[] = ["inter_campus", "outgoing", "incoming"];

interface HistoryPanelProps {
  studentId: string;
}

export function HistoryPanel({ studentId }: HistoryPanelProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const historyQuery = useQuery({
    queryKey: queryKeys.detail("students", "history", studentId),
    queryFn: async () =>
      (await apiClient.get<HistoryEvent[]>(`/students/${studentId}/history`)).data,
  });

  const transfersQuery = useQuery({
    queryKey: queryKeys.list("students", "student-transfers", { studentId }),
    queryFn: () =>
      collectPages<StudentTransferRecord>(apiClient, "/student-transfers", {
        query: { student_id: studentId },
      }),
  });

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.detail("students", "history", studentId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "student-transfers", { studentId }),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.detail("students", "student-enrollment", studentId),
    });
  }

  const approveMutation = useMutation({
    mutationFn: (transferId: string) => apiClient.post(`/student-transfers/${transferId}:approve`),
    onSuccess: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: (transferId: string) => apiClient.post(`/student-transfers/${transferId}:reject`),
    onSuccess: invalidate,
  });

  if (historyQuery.error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(historyQuery.error.code)
            ? tErrors(historyQuery.error.code)
            : historyQuery.error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (historyQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  const events = historyQuery.data ?? [];
  const transfers = transfersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{t("history.timelineTitle")}</h2>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <Card key={`${event.type}-${event.id}`}>
                <CardContent className="space-y-1 pt-4 pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {event.type === "enrollment"
                        ? t("history.event.enrollment", {
                            session: event.academic_session_name,
                            className: event.class_name,
                            section: event.section_name,
                          })
                        : t("history.event.transfer", {
                            type: t(`transfers.type.${event.transfer_type}`),
                          })}
                    </span>
                    <Badge variant="outline">{event.date}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{event.status}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{t("transfers.title")}</h2>
          <Can permission="students.transfer.create">
            <RequestTransferDialog studentId={studentId} onRequested={invalidate} />
          </Can>
        </div>

        {transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("transfers.empty")}</p>
        ) : (
          <div className="space-y-2">
            {transfers.map((transfer) => (
              <Card key={transfer.id}>
                <CardContent className="space-y-2 pt-4 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {t(`transfers.type.${transfer.transfer_type}`)}
                    </span>
                    <Badge
                      variant={
                        transfer.status === "completed"
                          ? "success"
                          : transfer.status === "rejected"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {t(`transfers.status.${transfer.status}`)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{transfer.reason}</p>
                  {transfer.status === "requested" ? (
                    <Can permission="students.transfer.approve">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={approveMutation.isPending}
                          onClick={() => {
                            approveMutation.mutate(transfer.id);
                          }}
                        >
                          {t("transfers.approve")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={rejectMutation.isPending}
                          onClick={() => {
                            rejectMutation.mutate(transfer.id);
                          }}
                        >
                          {t("transfers.reject")}
                        </Button>
                      </div>
                    </Can>
                  ) : null}
                  {transfer.status === "approved" ? (
                    <Can permission="students.transfer.create">
                      <CompleteTransferDialog transfer={transfer} onCompleted={invalidate} />
                    </Can>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestTransferDialog({
  studentId,
  onRequested,
}: {
  studentId: string;
  onRequested: () => void;
}) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const campuses = useCampuses();

  const [open, setOpen] = useState(false);
  const [transferType, setTransferType] = useState<TransferType>("inter_campus");
  const [fromCampusId, setFromCampusId] = useState("");
  const [toCampusId, setToCampusId] = useState("");
  const [externalSchoolName, setExternalSchoolName] = useState("");
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  function reset() {
    setTransferType("inter_campus");
    setFromCampusId("");
    setToCampusId("");
    setExternalSchoolName("");
    setReason("");
    setEffectiveDate("");
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post("/student-transfers", {
        student_id: studentId,
        transfer_type: transferType,
        from_campus_id: fromCampusId || null,
        to_campus_id: toCampusId || null,
        external_school_name: externalSchoolName || null,
        reason,
        effective_date: effectiveDate,
      }),
    onSuccess: () => {
      onRequested();
      setOpen(false);
      reset();
    },
  });

  const canSubmit = reason && effectiveDate;
  const mutationError =
    mutation.error instanceof ApiError
      ? tErrors.has(mutation.error.code)
        ? tErrors(mutation.error.code)
        : mutation.error.message
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t("transfers.request")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("transfers.request")}</DialogTitle>
          <DialogDescription>{t("transfers.requestDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-type">{t("transfers.fields.type")}</Label>
            <Select
              value={transferType}
              onValueChange={(value) => {
                setTransferType(value as TransferType);
              }}
            >
              <SelectTrigger id="transfer-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSFER_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`transfers.type.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {transferType !== "incoming" ? (
            <div className="space-y-1.5">
              <Label htmlFor="transfer-from-campus">{t("transfers.fields.fromCampus")}</Label>
              <Select value={fromCampusId} onValueChange={setFromCampusId}>
                <SelectTrigger id="transfer-from-campus">
                  <SelectValue placeholder={t("enrollment.fields.selectCampus")} />
                </SelectTrigger>
                <SelectContent>
                  {(campuses.data ?? []).map((campus) => (
                    <SelectItem key={campus.id} value={campus.id}>
                      {campus.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {transferType !== "outgoing" ? (
            <div className="space-y-1.5">
              <Label htmlFor="transfer-to-campus">{t("transfers.fields.toCampus")}</Label>
              <Select value={toCampusId} onValueChange={setToCampusId}>
                <SelectTrigger id="transfer-to-campus">
                  <SelectValue placeholder={t("enrollment.fields.selectCampus")} />
                </SelectTrigger>
                <SelectContent>
                  {(campuses.data ?? []).map((campus) => (
                    <SelectItem key={campus.id} value={campus.id}>
                      {campus.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {transferType !== "inter_campus" ? (
            <div className="space-y-1.5">
              <Label htmlFor="transfer-external-school">
                {t("transfers.fields.externalSchoolName")}
              </Label>
              <Input
                id="transfer-external-school"
                value={externalSchoolName}
                onChange={(event) => {
                  setExternalSchoolName(event.target.value);
                }}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="transfer-reason">{t("transfers.fields.reason")}</Label>
            <Input
              id="transfer-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-date">{t("transfers.fields.effectiveDate")}</Label>
            <Input
              id="transfer-date"
              type="date"
              value={effectiveDate}
              onChange={(event) => {
                setEffectiveDate(event.target.value);
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!canSubmit || mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("transfers.request")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteTransferDialog({
  transfer,
  onCompleted,
}: {
  transfer: StudentTransferRecord;
  onCompleted: () => void;
}) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const [open, setOpen] = useState(false);
  const [sectionId, setSectionId] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/student-transfers/${transfer.id}:complete`, {
        section_id: sectionId || null,
      }),
    onSuccess: () => {
      onCompleted();
      setOpen(false);
      setSectionId("");
    },
  });

  const mutationError =
    mutation.error instanceof ApiError
      ? tErrors.has(mutation.error.code)
        ? tErrors(mutation.error.code)
        : mutation.error.message
      : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("transfers.complete")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("transfers.complete")}</DialogTitle>
          <DialogDescription>{t("transfers.completeDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        {transfer.transfer_type === "inter_campus" ? (
          <div className="space-y-1.5">
            <Label htmlFor="complete-section">{t("enrollment.fields.section")}</Label>
            <Input
              id="complete-section"
              value={sectionId}
              onChange={(event) => {
                setSectionId(event.target.value);
              }}
              placeholder={t("transfers.fields.destinationSectionId")}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("transfers.complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
