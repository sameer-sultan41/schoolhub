"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { useTerms } from "@/hooks/use-reference-data";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatDate } from "@/lib/helpers";
import type { AcademicSessionRecord, TermRecord } from "@/services";
import { LOCKED_SESSION_STATUSES } from "@/services/modules/school-organization/school-organization-constant";
import { nextTermSequence } from "@/services/modules/school-organization/school-organization-helper";
import { TermFormDialog } from "./term-form-dialog";

export interface SessionTermsPanelProps {
  session: AcademicSessionRecord;
  canCreate: boolean;
  canUpdate: boolean;
}

/**
 * A session's terms, in their order, inside its expanded row: each one's name and dates, with
 * Add and Edit. Terms have no delete (`TermViewSet`), and a closed or archived session's terms
 * are read only, as the server refuses any write to them. Shares its cache entry with every
 * term picker (`useTerms`), so a term saved here is offered there too.
 */
export function SessionTermsPanel({ session, canCreate, canUpdate }: SessionTermsPanelProps) {
  const t = useTranslations("school");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const termsQuery = useTerms(session.id);
  // `null` is closed; `{}` is a new term; `{ record }` edits one.
  const [target, setTarget] = useState<{ record?: TermRecord } | null>(null);

  const isLocked = LOCKED_SESSION_STATUSES.includes(session.status);
  const showCreate = canCreate && !isLocked;
  const showEdit = canUpdate && !isLocked;
  const terms = termsQuery.data ?? [];

  if (termsQuery.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(termsQuery.error, tErrors, t("terms.loadError"))}
        onRetry={() => {
          void termsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {isLocked ? t("terms.locked") : t("terms.summary")}
        </p>
        {showCreate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTarget({});
            }}
          >
            <Plus aria-hidden="true" />
            {t("terms.actions.create")}
          </Button>
        )}
      </div>
      {termsQuery.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : terms.length === 0 ? (
        <p className="text-sm">{t("terms.empty")}</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">
            {t("terms.caption", { session: session.name })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-0">{t("terms.fields.sequence")}</TableHead>
              <TableHead>{t("fields.name")}</TableHead>
              <TableHead>{t("fields.startDate")}</TableHead>
              <TableHead>{t("fields.endDate")}</TableHead>
              {showEdit && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {terms.map((term) => (
              <TableRow key={term.id}>
                <TableCell>{term.sequence}</TableCell>
                <TableCell className="font-medium">{term.name}</TableCell>
                <TableCell>{formatDate(term.start_date, locale)}</TableCell>
                <TableCell>{formatDate(term.end_date, locale)}</TableCell>
                {showEdit && (
                  <TableCell>
                    <RowEditRemoveActions
                      editLabel={t("actions.editRow", { name: term.name })}
                      onEdit={() => {
                        setTarget({ record: term });
                      }}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {target && (
        <TermFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          session={session}
          record={target.record}
          nextSequence={nextTermSequence(terms)}
        />
      )}
    </div>
  );
}
