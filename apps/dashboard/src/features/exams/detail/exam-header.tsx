"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import type { ExamRecord } from "@/services";
import { isExamConfigurable, isExamDeletable } from "@/services/modules/exams/exams-helper";
import { ExamStatusBadge } from "@/features/exams/exam-status-badge";
import { DeleteExamDialog } from "@/features/exams/list/delete-exam-dialog";
import { ExamFormDialog } from "@/features/exams/list/exam-form-dialog";
import { ExamStatusStepper } from "./exam-status-stepper";

/**
 * The exam's name, session and term, dates, scale, weightage and status, its stepper, and what
 * the viewer can do to it. Edit stays visible but disabled once the exam is past `scheduled`
 * (its configuration is frozen on the server), with the reason on the button; Delete is offered
 * on a `draft` only. Each dialog is mounted only while open.
 */
export function ExamHeader({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const locale = useLocale();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: user } = useCurrentUser();
  const canEdit = hasPermission(user, "exams.exam.update");
  const canDelete = hasPermission(user, "exams.exam.delete") && isExamDeletable(exam.status);
  const configurable = isExamConfigurable(exam.status);

  const sessionTerm = exam.term_name
    ? t("detail.sessionTerm", { session: exam.academic_session_name, term: exam.term_name })
    : exam.academic_session_name;

  return (
    <>
      <Toolbar>
        <ToolbarHeading
          title={exam.name}
          description={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium text-foreground">{sessionTerm}</span>
              <span>
                {exam.starts_on && exam.ends_on
                  ? t("detail.dates", {
                      from: formatDate(exam.starts_on, locale),
                      to: formatDate(exam.ends_on, locale),
                    })
                  : t("detail.noDates")}
              </span>
              <span>{t("detail.scale", { name: exam.grading_scale_name })}</span>
              {exam.weightage_percent && (
                <span>{t("detail.weightage", { percent: exam.weightage_percent })}</span>
              )}
              <ExamStatusBadge status={exam.status} />
            </div>
          }
        />
        <ToolbarActions>
          <Button variant="outline" asChild>
            <Link href={Paths.EXAMS}>
              <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
              {t("actions.backToList")}
            </Link>
          </Button>
          {canEdit && (
            // On a wrapping `<span>`: a disabled button never shows its own `title`.
            <span title={configurable ? undefined : t("actions.frozen")}>
              <Button
                variant="outline"
                disabled={!configurable}
                onClick={() => {
                  setEditOpen(true);
                }}
              >
                <Pencil aria-hidden="true" />
                {t("actions.edit")}
              </Button>
            </span>
          )}
          {canDelete && (
            <Button
              variant="destructive"
              appearance="light"
              onClick={() => {
                setDeleteOpen(true);
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("actions.delete")}
            </Button>
          )}
        </ToolbarActions>
      </Toolbar>
      <div className="mb-6">
        <ExamStatusStepper status={exam.status} />
      </div>
      {editOpen && <ExamFormDialog open onOpenChange={setEditOpen} record={exam} />}
      {deleteOpen && (
        <DeleteExamDialog
          open
          onOpenChange={setDeleteOpen}
          record={exam}
          onDeleted={() => {
            router.push(Paths.EXAMS);
          }}
        />
      )}
    </>
  );
}
