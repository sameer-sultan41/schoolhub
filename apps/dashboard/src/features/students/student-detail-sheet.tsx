"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  Building2,
  Calendar,
  Droplet,
  FileText,
  Hash,
  Home,
  Pencil,
  School,
  UserMinus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
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
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { getInitials } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { statusVariant } from "./student-columns";
import type { StudentRow } from "./student-row";

export interface StudentDetailSheetProps {
  row: StudentRow | null;
  canUpdate: boolean;
  canWithdraw: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onWithdraw: (id: string, name: string) => void;
}

/** "3 days ago" rather than a raw ISO timestamp — the same `formatDistanceToNow` rendering
 * as `/staff`'s `formatLastUpdated` (`staff-directory-table.tsx`), replicated rather than
 * imported so this feature doesn't depend on another route's table module. */
function formatLastUpdated(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDistanceToNow(parsed, { addSuffix: true });
}

function FieldRow({
  icon: Icon,
  label,
  value,
  isPending,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  isPending: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary/70" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        {isPending ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          // `title` recovers a truncated value on hover/long-press — no `TooltipProvider`
          // is wired up anywhere in this app yet, so this is the zero-dependency fix
          // rather than new app-wide infrastructure for one field. Matters most for
          // `medical_notes`, which can run well past what a ~190px grid cell shows.
          <span className="truncate text-sm font-medium text-foreground" title={value || undefined}>
            {value || "—"}
          </span>
        )}
      </div>
    </div>
  );
}

/** The hero band's one status badge, rendered at two different DOM positions depending
 * on layout (beside the name on mobile, below the subtitle on desktop) — never both at
 * once, so `findByText` keeps finding a single match. Defined once so the two call
 * sites can't drift on variant/appearance/shape/children independently of each other;
 * only `className` (position-specific) varies per call. */
function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("students");
  return (
    <Badge
      size="sm"
      variant={statusVariant(status)}
      appearance="light"
      shape="circle"
      className={className}
    >
      <BadgeDot />
      {t(`status.${status}`)}
    </Badge>
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

export function StudentDetailSheet({
  row,
  canUpdate,
  canWithdraw,
  onOpenChange,
  onEdit,
  onWithdraw,
}: StudentDetailSheetProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  // A plain media-query hook, not `useIsDrawer()` — that one reads `ResponsiveSheet`'s own
  // context, which doesn't exist yet at this call site: this component is what RENDERS the
  // `ResponsiveSheet` below, so it sits outside that context, not inside it.
  const isDesktop = useIsDesktopShell();

  const detailQuery = useQuery({
    queryKey: queryKeys.detail("students", "students", row?.id ?? ""),
    queryFn: () => Services.students.fetchStudentById(row?.id as string),
    enabled: row !== null,
  });
  const data = detailQuery.data;
  // `"medical_notes" in data` — not `data?.medical_notes` / `?? ""` / truthiness — because
  // the backend *omits the key entirely* for a viewer without visibility, but sends it as
  // `null` for a viewer who can see it when the student simply has none on file. Those are
  // two different facts: "you can't see this" vs. "there's nothing to see." A falsy check
  // would conflate both as "Restricted".
  const hasMedicalNotesField = data !== undefined && "medical_notes" in data;
  const isPending = detailQuery.isPending;

  return (
    <ResponsiveSheet open={row !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent
        closeLabel={tCommon("close")}
        className="gap-0 p-0 sm:w-[440px] sm:max-w-none [&_[data-slot=sheet-close]]:end-5 [&_[data-slot=sheet-close]]:top-5"
      >
        <ResponsiveSheetTitle className="sr-only">
          {row ? t("detail.title", { name: row.name }) : t("detail.titleFallback")}
        </ResponsiveSheetTitle>
        {row && (
          <>
            <div
              className={
                isDesktop
                  ? "flex flex-col gap-3 border-b border-border bg-primary/5 px-6 py-6"
                  : "flex flex-row items-center gap-3 border-b border-border bg-primary/5 px-4 py-4"
              }
            >
              <Avatar
                className={
                  isDesktop
                    ? "size-16 shrink-0 ring-4 ring-background"
                    : "size-12 shrink-0 ring-2 ring-background"
                }
              >
                <AvatarImage src={row.signedPhotoUrl} alt="" />
                <AvatarFallback className={isDesktop ? "text-lg font-semibold" : "font-semibold"}>
                  {getInitials(row.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-mono truncate text-lg leading-none font-semibold text-foreground">
                    {row.name}
                  </span>
                  {!isDesktop && <StatusBadge status={row.status} className="w-fit shrink-0" />}
                </div>
                <span className="truncate text-sm text-muted-foreground">
                  {row.admissionNumber}
                </span>
                {isDesktop && <StatusBadge status={row.status} className="mt-1 w-fit" />}
              </div>
            </div>

            {/* flex-1 pins the footer to the bottom; overflow-y-auto scrolls long content. */}
            <ResponsiveSheetBody className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              {detailQuery.isError ? (
                <p className="text-sm text-muted-foreground">{t("detail.loadError")}</p>
              ) : (
                <>
                  <FieldSection title={t("detail.personal")}>
                    <FieldRow
                      icon={Hash}
                      label={t("fields.admissionNumber")}
                      value={data?.admission_number}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={UserRound}
                      label={t("fields.preferredName")}
                      value={data?.preferred_name}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={Calendar}
                      label={t("fields.dateOfBirth")}
                      value={data?.date_of_birth}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={UserRound}
                      label={t("fields.gender")}
                      value={data ? t(`gender.${data.gender}`) : undefined}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={Building2}
                      label={t("fields.nationality")}
                      value={data?.nationality}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={BookOpen}
                      label={t("fields.religion")}
                      value={data?.religion}
                      isPending={isPending}
                    />
                  </FieldSection>

                  <FieldSection title={t("detail.academic")}>
                    <FieldRow
                      icon={Building2}
                      label={t("fields.campus")}
                      value={data?.campus_name}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={Home}
                      label={t("fields.house")}
                      value={data?.house_name}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={Calendar}
                      label={t("fields.admissionDate")}
                      value={data?.admission_date}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={School}
                      label={t("fields.previousSchool")}
                      value={data?.previous_school}
                      isPending={isPending}
                    />
                  </FieldSection>

                  <FieldSection title={t("detail.medical")}>
                    <FieldRow
                      icon={Droplet}
                      label={t("fields.bloodGroup")}
                      value={data?.blood_group}
                      isPending={isPending}
                    />
                    <FieldRow
                      icon={FileText}
                      label={t("fields.medicalNotes")}
                      value={
                        hasMedicalNotesField
                          ? data.medical_notes
                          : t("fields.medicalNotesRestricted")
                      }
                      isPending={isPending}
                    />
                  </FieldSection>

                  {/* Same loading gate as every FieldRow above: a skeleton until the detail
                      arrives, never "Last updated " with nothing after it. */}
                  {data ? (
                    <span className="text-xs text-muted-foreground">
                      {t("detail.lastUpdated", { when: formatLastUpdated(data.updated_at) })}
                    </span>
                  ) : (
                    <Skeleton className="h-3 w-32" />
                  )}
                </>
              )}
            </ResponsiveSheetBody>

            <DetailFooter
              row={row}
              canUpdate={canUpdate}
              canWithdraw={canWithdraw}
              isDrawer={!isDesktop}
              onEdit={onEdit}
              onWithdraw={onWithdraw}
            />
          </>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function DetailFooter({
  row,
  canUpdate,
  canWithdraw,
  isDrawer,
  onEdit,
  onWithdraw,
}: {
  row: StudentRow;
  canUpdate: boolean;
  canWithdraw: boolean;
  isDrawer: boolean;
  onEdit: (id: string) => void;
  onWithdraw: (id: string, name: string) => void;
}) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const showWithdraw = canWithdraw && row.status === "active";

  if (isDrawer) {
    return (
      <ResponsiveSheetFooter className="flex-row justify-end gap-2.5 border-t border-border px-4 py-3">
        {canUpdate && (
          <Button
            variant="outline-primary"
            mode="icon"
            shape="circle"
            aria-label={tCommon("edit")}
            onClick={() => {
              onEdit(row.id);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        )}
        {showWithdraw && (
          <Button
            variant="destructive"
            mode="icon"
            shape="circle"
            aria-label={`${t("actions.withdraw")} ${row.name}`}
            onClick={() => {
              onWithdraw(row.id, row.name);
            }}
          >
            <UserMinus className="size-4" aria-hidden="true" />
          </Button>
        )}
      </ResponsiveSheetFooter>
    );
  }

  return (
    <ResponsiveSheetFooter className="border-t border-border px-6 py-4">
      {canUpdate && (
        <Button
          variant="outline-primary"
          onClick={() => {
            onEdit(row.id);
          }}
        >
          <Pencil className="size-4" aria-hidden="true" /> {tCommon("edit")}
        </Button>
      )}
      {showWithdraw && (
        <Button
          variant="destructive"
          onClick={() => {
            onWithdraw(row.id, row.name);
          }}
        >
          <UserMinus className="size-4" aria-hidden="true" /> {t("actions.withdraw")}
        </Button>
      )}
    </ResponsiveSheetFooter>
  );
}
