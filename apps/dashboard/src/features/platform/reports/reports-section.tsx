"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@schoolhub/ui";
import { Download } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { useUrlParams } from "@/hooks/use-url-params";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatLastUpdated, humanizeSnakeCase, saveBlob } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  PLATFORM_QUERY_MODULE,
  REPORT_KEYS,
  REPORT_RESOURCE,
  type ReportKey,
} from "@/services/modules/platform/platform-constant";

const REPORT_LABELS: Record<ReportKey, string> = {
  "tenant-overview": "reports.keys.tenantOverview",
  revenue: "reports.keys.revenue",
  usage: "reports.keys.usage",
};

function isReportKey(value: string | null): value is ReportKey {
  return value !== null && (REPORT_KEYS as readonly string[]).includes(value);
}

function cellText(value: unknown, locale: string): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (typeof value === "number") return value.toLocaleString(locale);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** A report row's key: rows carry no id, and a row's values are what it is (two identical rows
 * would render identically). */
function rowKey(row: Record<string, unknown>): string {
  return JSON.stringify(row);
}

/**
 * The platform reports (platform-admin.md §13): tenant overview, revenue, and usage and adoption,
 * as JSON sections of flat rows, and as one CSV file. Built from the nightly usage snapshots, so
 * they are as fresh as the last snapshot. The chosen report is in the URL (`?report=`).
 */
export function ReportsSection() {
  const t = useTranslations("platform");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { searchParams, setParams } = useUrlParams();
  const requested = searchParams.get("report");
  const key: ReportKey = isReportKey(requested) ? requested : "tenant-overview";

  const query = useQuery({
    queryKey: queryKeys.detail(PLATFORM_QUERY_MODULE, REPORT_RESOURCE, key),
    queryFn: () => Services.platform.fetchReport(key),
  });
  const download = useMutation({
    mutationFn: () => Services.platform.downloadReport(key),
    onSuccess: (blob) => {
      saveBlob(blob, `${key}.csv`);
    },
  });

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading title={t("reports.title")} description={t("reports.summary")} />
        <ToolbarActions>
          <Button
            variant="outline"
            isLoading={download.isPending}
            loadingLabel={t("reports.downloading")}
            onClick={() => {
              download.mutate();
            }}
          >
            <Download aria-hidden="true" />
            {t("reports.downloadCsv")}
          </Button>
        </ToolbarActions>
      </Toolbar>
      <Tabs
        value={key}
        onValueChange={(value) => {
          setParams({ report: value === "tenant-overview" ? null : value });
        }}
      >
        <TabsList aria-label={t("reports.choose")}>
          {REPORT_KEYS.map((reportKey) => (
            <TabsTrigger key={reportKey} value={reportKey}>
              {enumLabel(t, REPORT_LABELS, reportKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {download.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {resolveErrorMessage(download.error, tErrors, tCommon("submitFailed"))}
          </AlertDescription>
        </Alert>
      )}
      {query.isError ? (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("reports.loadError"))}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : !query.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("reports.generated", { when: formatLastUpdated(query.data.generated_at) })}
          </p>
          {Object.entries(query.data.sections).map(([name, rows]) => {
            const columns = rows[0] ? Object.keys(rows[0]) : [];
            const title = humanizeSnakeCase(name);
            return (
              <Card key={name}>
                <CardHeader>
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("reports.noRows")}</p>
                  ) : (
                    <Table>
                      <TableCaption className="sr-only">{title}</TableCaption>
                      <TableHeader>
                        <TableRow>
                          {columns.map((column) => (
                            <TableHead key={column}>{humanizeSnakeCase(column)}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={rowKey(row)}>
                            {columns.map((column) => (
                              <TableCell key={column}>{cellText(row[column], locale)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
