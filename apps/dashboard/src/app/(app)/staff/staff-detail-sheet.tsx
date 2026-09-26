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

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  BadgeDot,
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetTitle,
  Skeleton,
} from "@schoolhub/ui";

import { Services } from "@/services";
import {
  formatLastUpdated,
  humanizeSnakeCase,
  initialsOf,
  statusMeta,
  type StaffRow,
} from "@/app/(app)/staff/staff-directory-table";

/**
 * The row-click counterpart to `ActionsCell`'s ⋮ menu — same `onEdit`/`onDelete`
 * callbacks `StaffDirectoryTable` already passes there, just reached by clicking
 * anywhere in the row instead of opening the menu. `row` (not just a `staffId`) is what
 * drives `open`: the summary fields the table already has in memory (name, avatar,
 * status, designation, campus, last updated) render immediately in the hero band, with
 * only the fields below it waiting on `fetchStaffById`.
 *
 * Grouped field sections with a leading icon per row (Contact / Employment / Personal)
 * replace an earlier flat two-column `<dl>` — a person's record reads as a person first,
 * then a scannable set of facts about them, not one undifferentiated grid.
 */
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

export function StaffDetailSheet({ row, onOpenChange, onEdit, onDelete }: StaffDetailSheetProps) {
  // Same query key `staff-form-dialog.tsx`'s edit form uses for the same endpoint — opening
  // the sheet then clicking Edit reuses this fetch instead of firing a second one.
  const {
    data: detail,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["staff", "detail", row?.id],
    queryFn: () => Services.dashboard.fetchStaffById(row?.id as string),
    enabled: row !== null,
  });

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <SheetContent
        closeLabel="Close"
        className="gap-0 p-0 sm:w-[440px] sm:max-w-none [&_[data-slot=sheet-close]]:end-5 [&_[data-slot=sheet-close]]:top-5"
      >
        {/* Visually hidden — the hero band below carries the person's name as the
            visible heading; Radix's Dialog still needs a real Title for its
            aria-labelledby. */}
        <SheetTitle className="sr-only">
          {row ? `${row.name} — staff details` : "Staff details"}
        </SheetTitle>
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

            {/* flex-1: `SheetContent` is a fixed h-full flex column — without this, the
                footer just trails the body's own (usually much shorter) content height,
                leaving a large dead gap below it instead of sitting at the panel's
                bottom edge. overflow-y-auto lets long content scroll within its own
                area instead of pushing the footer off-screen. */}
            <SheetBody className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              <FieldSection title="Contact">
                <FieldRow icon={Mail} label="Email" value={detail?.email} loading={isPending} />
                <FieldRow icon={Phone} label="Phone" value={detail?.phone} loading={isPending} />
              </FieldSection>

              <FieldSection title="Employment">
                <FieldRow
                  icon={Briefcase}
                  label="Employee number"
                  value={detail?.employee_number}
                  loading={isPending}
                />
                <FieldRow
                  icon={Calendar}
                  label="Joining date"
                  value={detail?.joining_date ? formatDate(detail.joining_date) : undefined}
                  loading={isPending}
                />
                <FieldRow
                  icon={Briefcase}
                  label="Employment type"
                  value={
                    detail?.employment_type ? humanizeSnakeCase(detail.employment_type) : undefined
                  }
                  loading={isPending}
                />
                <FieldRow
                  icon={Fingerprint}
                  label="National ID"
                  value={detail?.national_id}
                  loading={isPending}
                />
              </FieldSection>

              <FieldSection title="Personal">
                <FieldRow
                  icon={UserRound}
                  label="Gender"
                  value={detail?.gender ? humanizeSnakeCase(detail.gender) : undefined}
                  loading={isPending}
                />
                <FieldRow
                  icon={Calendar}
                  label="Date of birth"
                  value={detail?.date_of_birth ? formatDate(detail.date_of_birth) : undefined}
                  loading={isPending}
                />
              </FieldSection>

              {detail?.public_bio && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-4">
                  <span className="text-xs font-medium text-muted-foreground">Bio</span>
                  <p className="text-sm text-foreground">{detail.public_bio}</p>
                </div>
              )}

              {isError && (
                <p className="text-sm text-destructive">
                  {"Couldn't load full details. Try again."}
                </p>
              )}

              <span className="text-xs text-muted-foreground">
                Last updated {formatLastUpdated(row.updatedAt)}
              </span>
            </SheetBody>

            {/* Gated on `row` along with the rest above (not rendered unconditionally
                after this block, the way it was before) — Radix keeps the panel mounted
                and sliding out for the whole close-transition duration after `row` goes
                null, and an ungated footer would stay visible and clickable floating
                over that now-blank body for the length of the animation. */}
            <SheetFooter className="border-t border-border px-6 py-4">
              {/* outline-primary (border-primary/40 bg-primary/5) instead of plain
                  outline — a filled tint reads as a real action next to the solid
                  destructive "Exit" button, not just a flat bordered box. */}
              <Button
                variant="outline-primary"
                onClick={() => {
                  onEdit(row.id);
                }}
              >
                <Pencil /> Edit
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onDelete(row.id, row.name);
                }}
              >
                <LogOut /> Exit
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
