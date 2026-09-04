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
import { useId, useState } from "react";
import { Can } from "@/components/can";
import { DEFAULT_DOCUMENT_TYPES } from "@/features/students/student-constants";
import type { StudentDocumentRecord } from "@/features/students/family-types";
import { useFileUpload } from "@/hooks/use-file-upload";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const DOCUMENT_UPLOAD_PURPOSE = "student.document";

interface DocumentsPanelProps {
  studentId: string;
}

export function DocumentsPanel({ studentId }: DocumentsPanelProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const documentsQuery = useQuery({
    queryKey: queryKeys.list("students", "student-documents", { studentId }),
    queryFn: () =>
      collectPages<StudentDocumentRecord>(apiClient, `/students/${studentId}/documents`),
  });

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "student-documents", { studentId }),
    });
  }

  const verifyMutation = useMutation({
    mutationFn: ({
      documentId,
      decision,
    }: {
      documentId: string;
      decision: "verified" | "rejected";
    }) => apiClient.post(`/student-documents/${documentId}:verify`, { decision }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => apiClient.delete(`/student-documents/${documentId}`),
    onSuccess: invalidate,
  });

  const downloadMutation = useMutation({
    mutationFn: async (fileId: string) =>
      (await apiClient.post<{ download_url: string }>(`/files/${fileId}:download`)).data,
    onSuccess: (data) => {
      window.open(data.download_url, "_blank", "noopener,noreferrer");
    },
  });

  if (documentsQuery.error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(documentsQuery.error.code)
            ? tErrors(documentsQuery.error.code)
            : documentsQuery.error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (documentsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  const documents = documentsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("documents.title")}</h2>
        <Can permission="students.document.create">
          <UploadDocumentDialog studentId={studentId} onUploaded={invalidate} />
        </Can>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("documents.empty")}</p>
      ) : (
        <div className="space-y-3">
          {documents.map((document) => (
            <Card key={document.id}>
              <CardContent className="space-y-2 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">{document.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`documents.type.${document.document_type}`)}
                      {document.expires_at
                        ? ` · ${t("documents.expiresOn", { date: document.expires_at })}`
                        : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      document.verification_status === "verified"
                        ? "success"
                        : document.verification_status === "rejected"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {t(`documents.status.${document.verification_status}`)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={downloadMutation.isPending}
                    onClick={() => {
                      downloadMutation.mutate(document.file_id);
                    }}
                  >
                    {t("documents.download")}
                  </Button>
                  {document.verification_status === "pending" ? (
                    <Can permission="students.document.verify">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={verifyMutation.isPending}
                        onClick={() => {
                          verifyMutation.mutate({ documentId: document.id, decision: "verified" });
                        }}
                      >
                        {t("documents.verify")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={verifyMutation.isPending}
                        onClick={() => {
                          verifyMutation.mutate({ documentId: document.id, decision: "rejected" });
                        }}
                      >
                        {t("documents.reject")}
                      </Button>
                    </Can>
                  ) : null}
                  <Can permission="students.document.delete">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        deleteMutation.mutate(document.id);
                      }}
                    >
                      {t("documents.delete")}
                    </Button>
                  </Can>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadDocumentDialog({
  studentId,
  onUploaded,
}: {
  studentId: string;
  onUploaded: () => void;
}) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const fileInputId = useId();

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>(DEFAULT_DOCUMENT_TYPES[0]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const upload = useFileUpload();

  function reset() {
    setFile(null);
    setDocumentType(DEFAULT_DOCUMENT_TYPES[0]);
    setTitle("");
    setNotes("");
    setExpiresAt("");
    upload.reset();
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("no file selected");
      const uploaded = await upload.mutateAsync({ file, purpose: DOCUMENT_UPLOAD_PURPOSE });
      return apiClient.post(`/students/${studentId}/documents`, {
        file_id: uploaded.id,
        document_type: documentType,
        title,
        notes: notes || null,
        expires_at: expiresAt || null,
      });
    },
    onSuccess: () => {
      onUploaded();
      setOpen(false);
      reset();
    },
  });

  const canSubmit = file && title.trim();
  const activeError = mutation.error ?? upload.error;
  const mutationError =
    activeError instanceof ApiError
      ? tErrors.has(activeError.code)
        ? tErrors(activeError.code)
        : activeError.message
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
        <Button size="sm">{t("documents.upload")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("documents.upload")}</DialogTitle>
          <DialogDescription>{t("documents.uploadDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={fileInputId}>{t("documents.fields.file")}</Label>
            <Input
              id={fileInputId}
              type="file"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="document-type">{t("documents.fields.documentType")}</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger id="document-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_DOCUMENT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`documents.type.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="document-title">{t("documents.fields.title")}</Label>
            <Input
              id="document-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="document-expires-at">{t("documents.fields.expiresAt")}</Label>
            <Input
              id="document-expires-at"
              type="date"
              value={expiresAt}
              onChange={(event) => {
                setExpiresAt(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="document-notes">{t("documents.fields.notes")}</Label>
            <Input
              id="document-notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {mutation.isPending ? t("documents.uploading") : t("documents.upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
