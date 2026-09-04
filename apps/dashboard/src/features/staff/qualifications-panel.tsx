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
import type { QualificationType, StaffQualificationRecord } from "@/features/staff/staff-types";
import { useFileUpload } from "@/hooks/use-file-upload";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const QUALIFICATION_TYPES: QualificationType[] = [
  "degree",
  "diploma",
  "certification",
  "training",
  "license",
];
const DEFAULT_QUALIFICATION_TYPE: QualificationType = "degree";

const QUALIFICATION_UPLOAD_PURPOSE = "staff.qualification";

interface QualificationsPanelProps {
  staffId: string;
}

export function QualificationsPanel({ staffId }: QualificationsPanelProps) {
  const t = useTranslations("staff");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const qualificationsQuery = useQuery({
    queryKey: queryKeys.list("staff", "staff-qualifications", { staffId }),
    queryFn: () =>
      collectPages<StaffQualificationRecord>(apiClient, `/staff/${staffId}/qualifications`),
  });

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("staff", "staff-qualifications", { staffId }),
    });
  }

  const verifyMutation = useMutation({
    mutationFn: ({
      qualificationId,
      decision,
    }: {
      qualificationId: string;
      decision: "verified" | "rejected";
    }) => apiClient.post(`/staff-qualifications/${qualificationId}:verify`, { decision }),
    onSuccess: invalidate,
  });

  if (qualificationsQuery.error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(qualificationsQuery.error.code)
            ? tErrors(qualificationsQuery.error.code)
            : qualificationsQuery.error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (qualificationsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  const qualifications = qualificationsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t("qualifications.title")}</h2>
        <Can permission="staff.qualification.create">
          <AddQualificationDialog staffId={staffId} onAdded={invalidate} />
        </Can>
      </div>

      {qualifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("qualifications.empty")}</p>
      ) : (
        <div className="space-y-3">
          {qualifications.map((qualification) => (
            <Card key={qualification.id}>
              <CardContent className="space-y-2 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">{qualification.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`qualifications.type.${qualification.qualification_type}`)}
                      {qualification.institution ? ` · ${qualification.institution}` : ""}
                      {qualification.year_awarded ? ` · ${qualification.year_awarded}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      qualification.verification_status === "verified"
                        ? "success"
                        : qualification.verification_status === "rejected"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {t(`qualifications.status.${qualification.verification_status}`)}
                  </Badge>
                </div>
                {qualification.verification_status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <Can permission="staff.qualification.verify">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={verifyMutation.isPending}
                        onClick={() => {
                          verifyMutation.mutate({
                            qualificationId: qualification.id,
                            decision: "verified",
                          });
                        }}
                      >
                        {t("qualifications.verify")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={verifyMutation.isPending}
                        onClick={() => {
                          verifyMutation.mutate({
                            qualificationId: qualification.id,
                            decision: "rejected",
                          });
                        }}
                      >
                        {t("qualifications.reject")}
                      </Button>
                    </Can>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AddQualificationDialog({ staffId, onAdded }: { staffId: string; onAdded: () => void }) {
  const t = useTranslations("staff");
  const tErrors = useTranslations("errors");
  const fileInputId = useId();

  const [open, setOpen] = useState(false);
  const [qualificationType, setQualificationType] = useState<QualificationType>(
    DEFAULT_QUALIFICATION_TYPE,
  );
  const [title, setTitle] = useState("");
  const [institution, setInstitution] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [yearAwarded, setYearAwarded] = useState("");
  const [grade, setGrade] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const upload = useFileUpload();

  function reset() {
    setQualificationType(DEFAULT_QUALIFICATION_TYPE);
    setTitle("");
    setInstitution("");
    setFieldOfStudy("");
    setYearAwarded("");
    setGrade("");
    setFile(null);
    upload.reset();
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const documentFileId = file
        ? (await upload.mutateAsync({ file, purpose: QUALIFICATION_UPLOAD_PURPOSE })).id
        : null;
      return apiClient.post(`/staff/${staffId}/qualifications`, {
        qualification_type: qualificationType,
        title,
        institution: institution || null,
        field_of_study: fieldOfStudy || null,
        year_awarded: yearAwarded ? Number(yearAwarded) : null,
        grade: grade || null,
        document_file_id: documentFileId,
      });
    },
    onSuccess: () => {
      onAdded();
      setOpen(false);
      reset();
    },
  });

  const canSubmit = title.trim();
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
        <Button size="sm">{t("qualifications.add")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("qualifications.close")}>
        <DialogHeader>
          <DialogTitle>{t("qualifications.add")}</DialogTitle>
          <DialogDescription>{t("qualifications.addDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qualification-type">
              {t("qualifications.fields.qualificationType")}
            </Label>
            <Select
              value={qualificationType}
              onValueChange={(value) => {
                setQualificationType(value as QualificationType);
              }}
            >
              <SelectTrigger id="qualification-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALIFICATION_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`qualifications.type.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qualification-title">{t("qualifications.fields.title")}</Label>
            <Input
              id="qualification-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qualification-institution">
              {t("qualifications.fields.institution")}
            </Label>
            <Input
              id="qualification-institution"
              value={institution}
              onChange={(event) => {
                setInstitution(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qualification-field-of-study">
              {t("qualifications.fields.fieldOfStudy")}
            </Label>
            <Input
              id="qualification-field-of-study"
              value={fieldOfStudy}
              onChange={(event) => {
                setFieldOfStudy(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qualification-year-awarded">
              {t("qualifications.fields.yearAwarded")}
            </Label>
            <Input
              id="qualification-year-awarded"
              type="number"
              value={yearAwarded}
              onChange={(event) => {
                setYearAwarded(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qualification-grade">{t("qualifications.fields.grade")}</Label>
            <Input
              id="qualification-grade"
              value={grade}
              onChange={(event) => {
                setGrade(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fileInputId}>{t("qualifications.fields.document")}</Label>
            <Input
              id={fileInputId}
              type="file"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
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
            {mutation.isPending ? t("qualifications.adding") : t("qualifications.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
