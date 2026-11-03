"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ArrowLeft, FileText, Pencil, Plus, Trash2 } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import type { QuestionBankRecord } from "@/services";
import { DEFAULT_BANK_STATUS } from "@/services/modules/question-banks/question-banks-constant";
import { AssemblePaperDialog, usePaperDownload } from "./assemble-paper-dialog";
import { BankStatusBadge } from "./bank-status-badge";
import { DeleteQuestionBankDialog } from "./delete-question-bank-dialog";
import { QuestionBankFormDialog } from "./question-bank-form-dialog";
import { QuestionFormDialog } from "./question-form-dialog";

type OpenDialog = "edit" | "delete" | "question" | "paper" | null;

/**
 * The bank's name, subject, class (or every level), question count and status, and what the
 * viewer may do with it: New question (`exams.question-bank.create`), Assemble paper and Edit
 * (`.update`), Delete (`.delete`). Each dialog is mounted only while open; the paper job lives
 * here, so closing Assemble paper mid-job still downloads the paper.
 */
export function BankHeader({ bank }: { bank: QuestionBankRecord }) {
  const t = useTranslations("exams");
  const router = useRouter();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const paper = usePaperDownload();
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  const { data: user } = useCurrentUser();
  const canCreate = hasPermission(user, "exams.question-bank.create");
  const canUpdate = hasPermission(user, "exams.question-bank.update");
  const canDelete = hasPermission(user, "exams.question-bank.delete");

  return (
    <>
      <Toolbar>
        <ToolbarHeading
          title={bank.name}
          description={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium text-foreground">{bank.subject_name}</span>
              <span>{bank.class_name ?? t("questionBanks.everyLevel")}</span>
              <span>{t("questionBanks.detail.questionCount", { count: bank.question_count })}</span>
              <BankStatusBadge status={bank.status ?? DEFAULT_BANK_STATUS} />
            </div>
          }
        />
        <ToolbarActions>
          <Button variant="outline" asChild>
            <Link href={Paths.EXAMS_QUESTION_BANKS}>
              <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
              {t("questionBanks.actions.backToList")}
            </Link>
          </Button>
          {canUpdate && (
            <Button
              variant="outline"
              onClick={() => {
                setDialog("edit");
              }}
            >
              <Pencil aria-hidden="true" />
              {t("questionBanks.actions.edit")}
            </Button>
          )}
          {canDelete && (
            <Button
              variant="destructive"
              appearance="light"
              onClick={() => {
                setDialog("delete");
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("questionBanks.actions.delete")}
            </Button>
          )}
          {canUpdate && (
            <Button
              variant="outline"
              onClick={() => {
                setDialog("paper");
              }}
            >
              <FileText aria-hidden="true" />
              {t("questionBanks.paper.open")}
            </Button>
          )}
          {canCreate && (
            <Button
              variant="primary"
              onClick={() => {
                setDialog("question");
              }}
            >
              <Plus aria-hidden="true" />
              {t("questionBanks.questions.actions.create")}
            </Button>
          )}
        </ToolbarActions>
      </Toolbar>
      {dialog === "edit" && <QuestionBankFormDialog open onOpenChange={close} record={bank} />}
      {dialog === "delete" && (
        <DeleteQuestionBankDialog
          open
          onOpenChange={close}
          record={bank}
          onDeleted={() => {
            router.push(Paths.EXAMS_QUESTION_BANKS);
          }}
        />
      )}
      {dialog === "question" && <QuestionFormDialog open onOpenChange={close} bankId={bank.id} />}
      {dialog === "paper" && (
        <AssemblePaperDialog open onOpenChange={close} bank={bank} paper={paper} />
      )}
    </>
  );
}
