"use client";

import type { ReactNode } from "react";
import {
  Briefcase,
  Calendar,
  Fingerprint,
  LogOut,
  Mail,
  Pencil,
  Phone,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  BadgeDot,
  Button,
  Skeleton,
} from "@schoolhub/ui";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetTitle,
  useIsDrawer,
} from "@/components/responsive-dialog";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  formatLastUpdated,
  humanizeSnakeCase,
  initialsOf,
  statusMeta,
  type StaffRow,
} from "@/app/(app)/staff/staff-directory-table";

/** Row-click detail view: row summary fields render at once, the rest after fetchStaffById. */
export interface StaffDetailSheetProps {
  row: StaffRow | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "PPP");
}

function FieldRow({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null | undefined;
  loading: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary/70" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        {loading ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          <span className="truncate text-sm font-medium text-foreground">{value || "—"}</span>
        )}
      </div>
    </div>
  );
}

function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">{children}</div>
    </section>
  );
}

/** Icon-only on the mobile drawer — a labeled button pair reads as two desktop-width
 * buttons stacked in a space this drawer's bottom-of-screen footer doesn't have to
 * spare; the side panel keeps the labels, where there's a full row's width for them. */
function DetailFooter({
  row,
  onEdit,
  onDelete,
}: {
  row: StaffRow;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const t = useTranslations("staff");
  const tCommon = useTranslations("common");
  const isDrawer = useIsDrawer();

  if (isDrawer) {
    return (
      <ResponsiveSheetFooter className="flex-row justify-end gap-2.5 border-t border-border px-4 py-3">
        {/* Full "<action> <name>" labels, not just "Edit"/"Exit": this sits right next
            to the drawer's own "Close" X, and "Exit" alone reads as leaving the panel,
            not leaving employment — the words this action actually performs. */}
        <Button
          variant="outline-primary"
          mode="icon"
          shape="circle"
          aria-label={`${tCommon("edit")} ${row.name}`}
          onClick={() => {
            onEdit(row.id);
          }}
        >
          <Pencil />
        </Button>
        <Button
          variant="destructive"
          mode="icon"
          shape="circle"
          aria-label={`${t("detail.exit")} ${row.name}`}
          onClick={() => {
            onDelete(row.id, row.name);
          }}
        >
          <LogOut />
        </Button>
      </ResponsiveSheetFooter>
    );
  }

  return (
    <ResponsiveSheetFooter className="border-t border-border px-6 py-4">
      {/* Tinted outline so Edit reads as an action beside the destructive Exit. */}
      <Button
        variant="outline-primary"
        onClick={() => {
          onEdit(row.id);
        }}
      >
        <Pencil /> {tCommon("edit")}
      </Button>
      <Button
        variant="destructive"
        onClick={() => {
          onDelete(row.id, row.name);
        }}
      >
        <LogOut /> {t("detail.exit")}
      </Button>
    </ResponsiveSheetFooter>
  );
}

export function StaffDetailSheet({ row, onOpenChange, onEdit, onDelete }: StaffDetailSheetProps) {
  const t = useTranslations("staff");
  // Same query key as the edit form, so clicking Edit reuses this fetch.
  const {
    data: detail,
    isPending,
    isError,
  } = useQuery({
    queryKey: queryKeys.detail("staff", "staff", row?.id ?? ""),
    queryFn: () => Services.dashboard.fetchStaffById(row?.id as string),
    enabled: row !== null,
  });

  return (
    <ResponsiveSheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <ResponsiveSheetContent
        closeLabel={t("detail.close")}
        className="gap-0 p-0 sm:w-[440px] sm:max-w-none [&_[data-slot=sheet-close]]:end-5 [&_[data-slot=sheet-close]]:top-5"
      >
        {/* Hidden: the hero band shows the name, but Radix needs a Title for aria-labelledby. */}
        <ResponsiveSheetTitle className="sr-only">
          {row ? t("detail.title", { name: row.name }) : t("detail.titleFallback")}
        </ResponsiveSheetTitle>
        {row && (
          <>
            <div className="flex flex-col gap-3 border-b border-border bg-primary/5 px-6 py-6">
              <Avatar className="size-16 shrink-0 ring-4 ring-background">
                {row.photoUrl ? <AvatarImage src={row.photoUrl} alt="" /> : null}
                <AvatarFallback className="text-lg font-semibold">
                  {initialsOf(row.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1.5">
                <span className="text-mono text-lg leading-none font-semibold text-foreground">
                  {row.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {row.designation} · {row.campus}
                </span>
                <Badge
                  size="sm"
                  variant={statusMeta(row.status).variant}
                  appearance="light"
                  shape="circle"
                  className="mt-1 w-fit"
                >
                  <BadgeDot />
                  {statusMeta(row.status).label}
                </Badge>
              </div>
            </div>

            {/* flex-1 pins the footer to the bottom; overflow-y-auto scrolls long content. */}
            <ResponsiveSheetBody className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              <FieldSection title={t("detail.contact")}>
                <FieldRow
                  icon={Mail}
                  label={t("fields.email")}
                  value={detail?.email}
                  loading={isPending}
                />
                <FieldRow
                  icon={Phone}
                  label={t("fields.phone")}
                  value={detail?.phone}
                  loading={isPending}
                />
              </FieldSection>

              <FieldSection title={t("detail.employment")}>
                <FieldRow
                  icon={Briefcase}
                  label={t("fields.employeeNumber")}
                  value={detail?.employee_number}
                  loading={isPending}
                />
                <FieldRow
                  icon={Calendar}
                  label={t("fields.joiningDate")}
                  value={detail?.joining_date ? formatDate(detail.joining_date) : undefined}
                  loading={isPending}
                />
                <FieldRow
                  icon={Briefcase}
                  label={t("fields.employmentType")}
                  value={
                    detail?.employment_type ? humanizeSnakeCase(detail.employment_type) : undefined
                  }
                  loading={isPending}
                />
                <FieldRow
                  icon={Fingerprint}
                  label={t("fields.nationalId")}
                  value={detail?.national_id}
                  loading={isPending}
                />
              </FieldSection>

              <FieldSection title={t("detail.personal")}>
                <FieldRow
                  icon={UserRound}
                  label={t("fields.gender")}
                  value={detail?.gender ? humanizeSnakeCase(detail.gender) : undefined}
                  loading={isPending}
                />
                <FieldRow
                  icon={Calendar}
                  label={t("fields.dateOfBirth")}
                  value={detail?.date_of_birth ? formatDate(detail.date_of_birth) : undefined}
                  loading={isPending}
                />
              </FieldSection>

              {detail?.public_bio && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-4">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("detail.bio")}
                  </span>
                  <p className="text-sm text-foreground">{detail.public_bio}</p>
                </div>
              )}

              {isError && <p className="text-sm text-destructive">{t("detail.loadError")}</p>}

              <span className="text-xs text-muted-foreground">
                {t("detail.lastUpdated", { when: formatLastUpdated(row.updatedAt) })}
              </span>
            </ResponsiveSheetBody>

            {/* Gated on row so the footer can't stay clickable during Radix's close animation. */}
            <DetailFooter row={row} onEdit={onEdit} onDelete={onDelete} />
          </>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
