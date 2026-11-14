"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { PaginationState } from "@tanstack/react-table";
import { Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { ArrowLeft, ScrollText } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { ReportGrid } from "@/components/reports/report-grid";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatMoney } from "@/lib/format-decimal";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import {
  FINANCE_REPORTS_QUERY_MODULE,
  STUDENT_STATEMENT_RESOURCE,
} from "@/services/modules/finance-reports/finance-reports-constant";
import { STUDENTS_QUERY_MODULE } from "@/services/modules/students/students-constant";
import { STATEMENT_VIEW_PERMISSION } from "./statement-link";
import { useStatementColumns } from "./statement-columns";

const STATEMENT_PAGE_SIZE = 25;

/**
 * `/fees/students/{id}/ledger`: one student's whole statement, the server's lines with its running
 * balances and its `closing_balance`. The student's name comes from the student read, fetched only
 * for a holder of `students.student.view` (L55); without it the heading is generic, the statement
 * itself needing only `fees.invoice.view`. A student the API can't find says so: it answers 404
 * alike for another school's student and for one that does not exist.
 */
export function StatementPage({ studentId }: { studentId: string }) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const columns = useStatementColumns();
  const { data: user } = useCurrentUser();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: STATEMENT_PAGE_SIZE,
  });

  const canView = hasPermission(user, STATEMENT_VIEW_PERMISSION);
  const canReadStudents = hasPermission(user, "students.student.view");

  const statement = useQuery({
    queryKey: queryKeys.detail(FINANCE_REPORTS_QUERY_MODULE, STUDENT_STATEMENT_RESOURCE, studentId),
    queryFn: () => Services.financeReports.fetchStudentStatement(studentId),
    enabled: canView,
  });
  const student = useQuery({
    queryKey: queryKeys.detail(STUDENTS_QUERY_MODULE, "students", studentId),
    queryFn: () => Services.students.fetchStudentById(studentId),
    enabled: canReadStudents,
  });

  const name = student.data
    ? t("reports.fullName", { first: student.data.first_name, last: student.data.last_name })
    : null;
  const heading = (
    <Toolbar>
      <ToolbarHeading
        title={name ? t("statement.title", { name }) : t("statement.titleGeneric")}
        description={t("statement.summary")}
      />
      <ToolbarActions>
        <Button variant="outline" asChild>
          <Link href={Paths.FEES_INVOICES}>
            <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
            {t("invoices.actions.backToList")}
          </Link>
        </Button>
      </ToolbarActions>
    </Toolbar>
  );

  if (statement.data) {
    const { entries, closingBalance } = statement.data;
    return (
      <>
        {heading}
        <div className="space-y-5">
          <Card>
            <CardContent className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{t("statement.closingBalance")}</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatMoney(locale, closingBalance)}
              </span>
            </CardContent>
          </Card>
          <ReportGrid
            title={t("statement.tableTitle")}
            emptyDescription={t("statement.emptyDescription")}
            rows={entries}
            columns={columns}
            pagination={pagination}
            onPaginationChange={setPagination}
          />
        </div>
      </>
    );
  }

  if (!canView && user) {
    return (
      <>
        {heading}
        <Card>
          <CardContent>
            <EmptyState
              icon={ScrollText}
              title={t("statement.restricted.title")}
              description={t("statement.restricted.description")}
            />
          </CardContent>
        </Card>
      </>
    );
  }

  if (statement.error instanceof ApiError && statement.error.isNotFound) {
    return (
      <EmptyState
        icon={ScrollText}
        title={t("statement.notFoundTitle")}
        description={t("statement.notFoundDescription")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.FEES_INVOICES}>{t("invoices.actions.backToList")}</Link>
          </Button>
        }
      />
    );
  }

  if (statement.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(statement.error, tErrors, t("statement.loadError"))}
        onRetry={() => {
          void statement.refetch();
        }}
      />
    );
  }

  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{tCommon("loading")}</span>
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
