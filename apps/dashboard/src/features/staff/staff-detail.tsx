"use client";

import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Can } from "@/components/can";
import { DocumentsPanel } from "@/features/staff/documents-panel";
import { QualificationsPanel } from "@/features/staff/qualifications-panel";
import type { StaffRecord } from "@/features/staff/staff-types";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

interface StaffDetailProps {
  staffId: string;
}

/** Em dash for a missing optional value — the house convention, mirrors
 * student-detail.tsx's EMPTY. */
const EMPTY = "—";

export function StaffDetail({ staffId }: StaffDetailProps) {
  const t = useTranslations("staff");
  const tErrors = useTranslations("errors");
  const locale = useLocale();

  const {
    data: staff,
    isPending,
    error,
  } = useQuery({
    queryKey: queryKeys.detail("staff", "staff", staffId),
    queryFn: async () => (await apiClient.get<StaffRecord>(`/staff/${staffId}`)).data,
  });

  if (error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(error.code) ? tErrors(error.code) : error.message}
          {error.requestId ? ` ${tErrors("requestId", { requestId: error.requestId })}` : ""}
        </AlertDescription>
      </Alert>
    );
  }

  if (isPending || !staff) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const name = `${staff.first_name} ${staff.last_name}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">{name}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{staff.employee_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{t(`employmentStatus.${staff.employment_status}`)}</Badge>
          <Can permission="staff.staff.update">
            <Button asChild variant="outline" size="sm">
              <Link href={`/staff/${staff.id}/edit`}>{t("form.editTitle")}</Link>
            </Button>
          </Can>
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t("tabs.profile")}</TabsTrigger>
          <TabsTrigger value="qualifications">{t("tabs.qualifications")}</TabsTrigger>
          <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6 pt-4">
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
              <dl className="contents">
                <Field
                  label={t("fields.dateOfBirth")}
                  value={staff.date_of_birth ? formatDate(staff.date_of_birth, locale) : EMPTY}
                />
                <Field label={t("fields.gender")} value={t(`gender.${staff.gender}`)} />
                <Field label={t("fields.staffType")} value={t(`staffType.${staff.staff_type}`)} />
                <Field
                  label={t("fields.employmentType")}
                  value={t(`employmentType.${staff.employment_type}`)}
                />
                <Field
                  label={t("fields.joiningDate")}
                  value={formatDate(staff.joining_date, locale)}
                />
                <Field label={t("fields.email")} value={staff.email ?? EMPTY} />
                <Field label={t("fields.phone")} value={staff.phone} />
                <Field label={t("fields.nationalId")} value={staff.national_id ?? EMPTY} />
              </dl>
            </CardContent>
          </Card>

          {staff.public_bio ? (
            <Card>
              <CardContent className="space-y-2 pt-6">
                <h2 className="text-sm font-medium text-foreground">{t("fields.publicBio")}</h2>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {staff.public_bio}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="qualifications" className="pt-4">
          <QualificationsPanel staffId={staffId} />
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <DocumentsPanel staffId={staffId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
