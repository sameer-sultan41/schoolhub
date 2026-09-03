"use client";

import { ApiError } from "@schoolhub/api-client";
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
import type { EnrollmentHistoryEvent, HistoryEvent } from "@/features/students/enrollment-types";
import {
  useAcademicSessions,
  useClasses,
  useSectionsForClass,
} from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface EnrollmentPanelProps {
  studentId: string;
}

export function EnrollmentPanel({ studentId }: EnrollmentPanelProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  // There is no GET /student-enrollments — the enrollment lifecycle is
  // reachable only through the :enroll/:change-section/:withdraw colon-actions
  // and the assembled history timeline, so that timeline doubles as the
  // "what is this student's current placement" read here.
  const enrollmentQuery = useQuery({
    queryKey: queryKeys.detail("students", "student-enrollment", studentId),
    queryFn: async () => {
      const events = (await apiClient.get<HistoryEvent[]>(`/students/${studentId}/history`)).data;
      const active = events.find(
        (event): event is EnrollmentHistoryEvent =>
          event.type === "enrollment" && event.status === "active",
      );
      return active ?? null;
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.detail("students", "student-enrollment", studentId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.detail("students", "history", studentId),
    });
  }

  const withdrawMutation = useMutation({
    mutationFn: (payload: { reason: string; effective_date: string }) =>
      apiClient.post(`/students/${studentId}:withdraw`, payload),
    onSuccess: invalidate,
  });

  if (enrollmentQuery.error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(enrollmentQuery.error.code)
            ? tErrors(enrollmentQuery.error.code)
            : enrollmentQuery.error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (enrollmentQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  const enrollment = enrollmentQuery.data;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">{t("enrollment.title")}</h2>
          {enrollment ? (
            <div className="flex gap-2">
              <Can permission="students.enrollment.update">
                <ChangeSectionDialog
                  studentId={studentId}
                  enrollment={enrollment}
                  onChanged={invalidate}
                />
              </Can>
              <Can permission="students.student.withdraw">
                <WithdrawDialog
                  onWithdraw={(payload) => {
                    withdrawMutation.mutate(payload);
                  }}
                  isPending={withdrawMutation.isPending}
                  error={withdrawMutation.error}
                />
              </Can>
            </div>
          ) : (
            <Can permission="students.enrollment.enroll">
              <EnrollDialog studentId={studentId} onEnrolled={invalidate} />
            </Can>
          )}
        </div>

        {enrollment ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge>{t(`enrollment.status.${enrollment.status}`)}</Badge>
            {enrollment.roll_number ? (
              <span>{t("enrollment.rollNumber", { roll: enrollment.roll_number })}</span>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("enrollment.notEnrolled")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function EnrollDialog({ studentId, onEnrolled }: { studentId: string; onEnrolled: () => void }) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const [open, setOpen] = useState(false);
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const sessions = useAcademicSessions();
  const classes = useClasses();
  const sections = useSectionsForClass(classId || undefined);

  function reset() {
    setAcademicSessionId("");
    setClassId("");
    setSectionId("");
    setEnrollmentDate("");
    setRollNumber("");
    setOverrideReason("");
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/students/${studentId}:enroll`, {
        academic_session_id: academicSessionId,
        class_id: classId,
        section_id: sectionId,
        enrollment_date: enrollmentDate,
        roll_number: rollNumber || null,
        capacity_override_reason: overrideReason || null,
      }),
    onSuccess: () => {
      onEnrolled();
      setOpen(false);
      reset();
    },
  });

  const canSubmit = academicSessionId && classId && sectionId && enrollmentDate;
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
        <Button size="sm">{t("enrollment.enroll")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("enrollment.enroll")}</DialogTitle>
          <DialogDescription>{t("enrollment.enrollDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="enroll-session">{t("enrollment.fields.academicSession")}</Label>
            <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
              <SelectTrigger id="enroll-session">
                <SelectValue placeholder={t("enrollment.fields.selectSession")} />
              </SelectTrigger>
              <SelectContent>
                {(sessions.data ?? []).map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="enroll-class">{t("enrollment.fields.class")}</Label>
            <Select
              value={classId}
              onValueChange={(value) => {
                setClassId(value);
                setSectionId("");
              }}
            >
              <SelectTrigger id="enroll-class">
                <SelectValue placeholder={t("enrollment.fields.selectClass")} />
              </SelectTrigger>
              <SelectContent>
                {(classes.data ?? []).map((classOption) => (
                  <SelectItem key={classOption.id} value={classOption.id}>
                    {classOption.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="enroll-section">{t("enrollment.fields.section")}</Label>
            <Select value={sectionId} onValueChange={setSectionId} disabled={!classId}>
              <SelectTrigger id="enroll-section">
                <SelectValue placeholder={t("enrollment.fields.selectSection")} />
              </SelectTrigger>
              <SelectContent>
                {(sections.data ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="enroll-date">{t("enrollment.fields.enrollmentDate")}</Label>
            <Input
              id="enroll-date"
              type="date"
              value={enrollmentDate}
              onChange={(event) => {
                setEnrollmentDate(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="enroll-roll">{t("enrollment.fields.rollNumber")}</Label>
            <Input
              id="enroll-roll"
              value={rollNumber}
              onChange={(event) => {
                setRollNumber(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="enroll-override">{t("enrollment.fields.overrideReason")}</Label>
            <Input
              id="enroll-override"
              value={overrideReason}
              onChange={(event) => {
                setOverrideReason(event.target.value);
              }}
              placeholder={t("enrollment.fields.overrideReasonHint")}
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
            {t("enrollment.enroll")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeSectionDialog({
  studentId,
  enrollment,
  onChanged,
}: {
  studentId: string;
  enrollment: EnrollmentHistoryEvent;
  onChanged: () => void;
}) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const [open, setOpen] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const sections = useSectionsForClass(enrollment.class_id);

  function reset() {
    setSectionId("");
    setRollNumber("");
    setOverrideReason("");
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/students/${studentId}:change-section`, {
        section_id: sectionId,
        roll_number: rollNumber || null,
        capacity_override_reason: overrideReason || null,
      }),
    onSuccess: () => {
      onChanged();
      setOpen(false);
      reset();
    },
  });

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
        <Button variant="outline" size="sm">
          {t("enrollment.changeSection")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("enrollment.changeSection")}</DialogTitle>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="change-section">{t("enrollment.fields.section")}</Label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger id="change-section">
                <SelectValue placeholder={t("enrollment.fields.selectSection")} />
              </SelectTrigger>
              <SelectContent>
                {(sections.data ?? [])
                  .filter((section) => section.id !== enrollment.section_id)
                  .map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-roll">{t("enrollment.fields.rollNumber")}</Label>
            <Input
              id="change-roll"
              value={rollNumber}
              onChange={(event) => {
                setRollNumber(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-override">{t("enrollment.fields.overrideReason")}</Label>
            <Input
              id="change-override"
              value={overrideReason}
              onChange={(event) => {
                setOverrideReason(event.target.value);
              }}
              placeholder={t("enrollment.fields.overrideReasonHint")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!sectionId || mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("enrollment.changeSection")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  onWithdraw,
  isPending,
  error,
}: {
  onWithdraw: (payload: { reason: string; effective_date: string }) => void;
  isPending: boolean;
  error: unknown;
}) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const reasonId = useId();
  const dateId = useId();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  const mutationError =
    error instanceof ApiError
      ? tErrors.has(error.code)
        ? tErrors(error.code)
        : error.message
      : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          {t("enrollment.withdraw")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("guardians.close")}>
        <DialogHeader>
          <DialogTitle>{t("enrollment.withdraw")}</DialogTitle>
          <DialogDescription>{t("enrollment.withdrawDescription")}</DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="danger">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>{t("enrollment.fields.reason")}</Label>
            <Input
              id={reasonId}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={dateId}>{t("enrollment.fields.effectiveDate")}</Label>
            <Input
              id={dateId}
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
            variant="danger"
            disabled={!reason || !effectiveDate || isPending}
            onClick={() => {
              onWithdraw({ reason, effective_date: effectiveDate });
              setOpen(false);
            }}
          >
            {t("enrollment.withdraw")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
