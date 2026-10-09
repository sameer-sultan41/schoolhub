"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  Building2,
  Calendar,
  Droplet,
  FileText,
  Hash,
  Home,
  School,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  BadgeDot,
  Skeleton,
} from "@schoolhub/ui";

import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetTitle,
} from "@/components/responsive-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { getInitials } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { formatLastUpdated } from "@/services/modules/students/students-helper";
import type { StudentRow } from "@/services/modules/students/students-type";
import { statusVariant } from "./student-columns";
import { StudentDetailFooter } from "./student-detail-footer";
import { StudentDetailTabs } from "./student-detail-tabs";

export interface StudentDetailSheetProps {
  row: StudentRow | null;
  canUpdate: boolean;
  canWithdraw: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onWithdraw: (id: string, name: string) => void;
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
      <Icon
        className="mt-0.5 size-4 shrink-0 text-primary/70"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        {isPending ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          // `title` recovers a truncated value on hover/long-press — no `TooltipProvider`
          // is wired up anywhere in this app yet, so this is the zero-dependency fix
          // rather than new app-wide infrastructure for one field. Matters most for
          // `medical_notes`, which can run well past what a ~190px grid cell shows.
          <span
            className="truncate text-sm font-medium text-foreground"
            title={value || undefined}
          >
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
function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
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

function FieldSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
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
  const { data: currentUser } = useCurrentUser();
  const canViewGuardians = hasPermission(currentUser, "students.guardian.view");
  const canViewEmergencyContacts = hasPermission(
    currentUser,
    "students.student.view",
  );
  const canViewDocuments = hasPermission(currentUser, "students.document.view");
  // No dedicated students.enrollment.view/students.transfer.view key exists — both reuse
  // students.student.view, confirmed against the real permission registry.
  const canViewEnrollment = hasPermission(currentUser, "students.student.view");
  const enrollmentPermissions = {
    canEnroll: hasPermission(currentUser, "students.enrollment.enroll"),
    canChangeSection: hasPermission(currentUser, "students.enrollment.update"),
    canOverrideCapacity: hasPermission(currentUser, "students.student.update"),
    canRequestTransfer: hasPermission(currentUser, "students.transfer.create"),
    canDecide: hasPermission(currentUser, "students.transfer.approve"),
    canComplete: hasPermission(currentUser, "students.transfer.create"),
  };

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

  // Data-driven instead of one <FieldRow> per field: every row shares the same
  // icon/label/value/isPending shape, so the only thing that varies is which icon and
  // which piece of `data` (or derived string) feeds it. Grouped by section since
  // that's how the sheet renders its three headings.
  const sections: {
    title: string;
    fields: {
      icon: LucideIcon;
      label: string;
      value: string | null | undefined;
    }[];
  }[] = [
    {
      title: t("detail.personal"),
      fields: [
        {
          icon: Hash,
          label: t("fields.admissionNumber"),
          value: data?.admission_number,
        },
        {
          icon: UserRound,
          label: t("fields.preferredName"),
          value: data?.preferred_name,
        },
        {
          icon: Calendar,
          label: t("fields.dateOfBirth"),
          value: data?.date_of_birth,
        },
        {
          icon: UserRound,
          label: t("fields.gender"),
          value: data ? t(`gender.${data.gender}`) : undefined,
        },
        {
          icon: Building2,
          label: t("fields.nationality"),
          value: data?.nationality,
        },
        { icon: BookOpen, label: t("fields.religion"), value: data?.religion },
      ],
    },
    {
      title: t("detail.academic"),
      fields: [
        {
          icon: Building2,
          label: t("fields.campus"),
          value: data?.campus_name,
        },
        { icon: Home, label: t("fields.house"), value: data?.house_name },
        {
          icon: Calendar,
          label: t("fields.admissionDate"),
          value: data?.admission_date,
        },
        {
          icon: School,
          label: t("fields.previousSchool"),
          value: data?.previous_school,
        },
      ],
    },
    {
      title: t("detail.medical"),
      fields: [
        {
          icon: Droplet,
          label: t("fields.bloodGroup"),
          value: data?.blood_group,
        },
        {
          icon: FileText,
          label: t("fields.medicalNotes"),
          value: hasMedicalNotesField
            ? data.medical_notes
            : t("fields.medicalNotesRestricted"),
        },
      ],
    },
  ];

  const profileContent = detailQuery.isError ? (
    <p className="text-sm text-muted-foreground">{t("detail.loadError")}</p>
  ) : (
    <>
      {sections.map((section) => (
        <FieldSection key={section.title} title={section.title}>
          {section.fields.map((field) => (
            <FieldRow
              key={field.label}
              icon={field.icon}
              label={field.label}
              value={field.value}
              isPending={isPending}
            />
          ))}
        </FieldSection>
      ))}
      {data ? (
        <span className="text-xs text-muted-foreground">
          {t("detail.lastUpdated", {
            when: formatLastUpdated(data.updated_at),
          })}
        </span>
      ) : (
        <Skeleton className="h-3 w-32" />
      )}
    </>
  );

  return (
    <ResponsiveSheet open={row !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent
        closeLabel={tCommon("close")}
        className="gap-0 p-0 sm:w-[440px] sm:max-w-none [&_[data-slot=sheet-close]]:end-5 [&_[data-slot=sheet-close]]:top-5"
      >
        <ResponsiveSheetTitle className="sr-only">
          {row
            ? t("detail.title", { name: row.name })
            : t("detail.titleFallback")}
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
                <AvatarFallback
                  className={
                    isDesktop ? "text-lg font-semibold" : "font-semibold"
                  }
                >
                  {getInitials(row.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-mono truncate text-lg leading-none font-semibold text-foreground">
                    {row.name}
                  </span>
                  {!isDesktop && (
                    <StatusBadge
                      status={row.status}
                      className="w-fit shrink-0"
                    />
                  )}
                </div>
                <span className="truncate text-sm text-muted-foreground">
                  {row.admissionNumber}
                </span>
                {isDesktop && (
                  <StatusBadge status={row.status} className="mt-1 w-fit" />
                )}
              </div>
            </div>

            <StudentDetailTabs
              key={row.id}
              studentId={row.id}
              profileContent={profileContent}
              currentUser={currentUser}
              canViewGuardians={canViewGuardians}
              canViewEmergencyContacts={canViewEmergencyContacts}
              canViewDocuments={canViewDocuments}
              canViewEnrollment={canViewEnrollment}
              enrollmentPermissions={enrollmentPermissions}
              campusId={data?.campus_id}
            />

            <StudentDetailFooter
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
