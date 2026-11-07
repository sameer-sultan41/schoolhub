"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Receipt } from "lucide-react";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useTerms } from "@/hooks/use-reference-data";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import type { FeeScheduleRecord, FeeStructureRecord } from "@/services";
import { DEFAULT_FEE_FREQUENCY } from "@/services/modules/fee-schedules/fee-schedules-constant";
import { dueRuleFor } from "@/services/modules/fee-schedules/fee-schedules-helper";
import { isStructureEditable } from "@/services/modules/fee-structures/fee-structures-helper";
import {
  FEE_FREQUENCY_LABEL_KEY,
  STRUCTURE_STATUS_LABEL_KEY,
} from "@/features/fees/shared/fee-setup-labels";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { useFeeHeadOptions } from "@/features/fees/shared/use-fee-options";
import { DeleteScheduleDialog } from "./delete-schedule-dialog";
import { ScheduleFormDialog } from "./schedule-form-dialog";

type FormTarget = { record?: FeeScheduleRecord };

/**
 * A structure's schedules, read from the structure itself: one row per fee head with its amount
 * (display only, no currency symbol), frequency and due rule. Add, Edit and Remove need
 * `fees.fee-structure.create|update|delete` and a draft structure; an active or archived one is
 * fixed, which the page says. Each dialog is mounted only while open.
 */
export function SchedulesCard({ structure }: { structure: FeeStructureRecord }) {
  const t = useTranslations("fees");
  const locale = useLocale();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeeScheduleRecord | null>(null);

  const { data: user } = useCurrentUser();
  const isDraft = isStructureEditable(structure);
  const canCreate = isDraft && hasPermission(user, "fees.fee-structure.create");
  const canUpdate = isDraft && hasPermission(user, "fees.fee-structure.update");
  const canDelete = isDraft && hasPermission(user, "fees.fee-structure.delete");
  const hasActions = canUpdate || canDelete;

  const headsQuery = useFeeHeadOptions();
  const headNames = new Map(
    (headsQuery.data ?? []).map((head) => [head.id, `${head.code} ${head.name}`]),
  );
  const termsQuery = useTerms(
    hasPermission(user, "school.academic-session.view") ? structure.academic_session : "",
  );
  const termNames = new Map((termsQuery.data ?? []).map((term) => [term.id, term.name]));

  const headName = (schedule: FeeScheduleRecord) => headNames.get(schedule.fee_head) ?? EMPTY_VALUE;

  function dueRule(schedule: FeeScheduleRecord): string {
    const rule = dueRuleFor(schedule.frequency ?? DEFAULT_FEE_FREQUENCY);
    if (rule.usesDueDay && schedule.due_day !== null && schedule.due_day !== undefined) {
      return t("structures.schedules.due.day", { day: schedule.due_day });
    }
    if (rule.usesDueDate && schedule.due_date) {
      return t("structures.schedules.due.date", { date: formatDate(schedule.due_date, locale) });
    }
    if (rule.usesTerm && schedule.term) {
      return t("structures.schedules.due.term", {
        term: termNames.get(schedule.term) ?? EMPTY_VALUE,
      });
    }
    return EMPTY_VALUE;
  }

  return (
    <>
      <FeesTabHeader
        createLabel={t("structures.schedules.actions.create")}
        onCreate={
          canCreate
            ? () => {
                setFormTarget({});
              }
            : undefined
        }
      />
      {!isDraft && (
        <p className="pb-4 text-sm text-muted-foreground">
          {t("structures.detail.fixed", {
            status: enumLabel(t, STRUCTURE_STATUS_LABEL_KEY, structure.status).toLowerCase(),
          })}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("structures.schedules.title")}</CardTitle>
          </CardHeading>
        </CardHeader>
        <CardContent className="p-0">
          {structure.schedules.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={t("structures.schedules.emptyTitle")}
              description={t("structures.schedules.emptyDescription")}
            />
          ) : (
            <Table>
              <TableCaption className="sr-only">{t("structures.schedules.caption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("structures.schedules.columns.head")}</TableHead>
                  <TableHead className="text-end">
                    {t("structures.schedules.columns.amount")}
                  </TableHead>
                  <TableHead>{t("structures.schedules.columns.frequency")}</TableHead>
                  <TableHead>{t("structures.schedules.columns.dueRule")}</TableHead>
                  {hasActions && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {structure.schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      {headsQuery.isLoading ? (
                        <Skeleton className="h-4 w-32" />
                      ) : (
                        headName(schedule)
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatMoney(locale, schedule.amount)}
                    </TableCell>
                    <TableCell>
                      {enumLabel(
                        t,
                        FEE_FREQUENCY_LABEL_KEY,
                        schedule.frequency ?? DEFAULT_FEE_FREQUENCY,
                      )}
                    </TableCell>
                    <TableCell>{dueRule(schedule)}</TableCell>
                    {hasActions && (
                      <TableCell>
                        <RowEditRemoveActions
                          editLabel={
                            canUpdate
                              ? t("structures.schedules.actions.editRow", {
                                  name: headName(schedule),
                                })
                              : undefined
                          }
                          onEdit={() => {
                            setFormTarget({ record: schedule });
                          }}
                          removeLabel={
                            canDelete
                              ? t("structures.schedules.actions.deleteRow", {
                                  name: headName(schedule),
                                })
                              : undefined
                          }
                          onRemove={() => {
                            setDeleteTarget(schedule);
                          }}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {formTarget && (
        <ScheduleFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          structure={structure}
          record={formTarget.record}
        />
      )}
      {deleteTarget && (
        <DeleteScheduleDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          record={deleteTarget}
          headName={headName(deleteTarget)}
        />
      )}
    </>
  );
}
