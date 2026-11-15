"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, BadgeDot, Button, cn, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { ChevronRight } from "lucide-react";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { formatDate } from "@/lib/helpers";
import type { AcademicSessionRecord, AcademicSessionStatus } from "@/services";
import {
  LOCKED_SESSION_STATUSES,
  SESSION_TERMS_COLUMN_ID,
  STRUCTURE_ACTIONS_COLUMN_ID,
} from "@/services/modules/school-organization/school-organization-constant";
import type { SessionLifecycleAction } from "./session-lifecycle-dialog";
import { SessionTermsPanel } from "./session-terms-panel";

const STATUS_VARIANT: Record<AcademicSessionStatus, "info" | "success" | "secondary"> = {
  planned: "info",
  active: "success",
  closed: "secondary",
  archived: "secondary",
};

/** A session's status, and "Current" on the one the school is working in. */
function SessionStatusBadges({ session }: { session: AcademicSessionRecord }) {
  const t = useTranslations("school");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={STATUS_VARIANT[session.status]} appearance="light">
        <BadgeDot />
        {t(`sessions.status.${session.status}`)}
      </Badge>
      {session.is_current && (
        <Badge variant="primary" appearance="outline">
          {t("sessions.current")}
        </Badge>
      )}
    </span>
  );
}

export interface SessionColumnPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canActivate: boolean;
  canClose: boolean;
}

export interface SessionColumnHandlers {
  onEdit: (session: AcademicSessionRecord) => void;
  onLifecycle: (session: AcademicSessionRecord, action: SessionLifecycleAction) => void;
  onClone: (session: AcademicSessionRecord) => void;
}

/**
 * The sessions table's columns; sortable ids are the keys of `SESSION_SORT_FIELD`. The first
 * column opens a row onto its terms. Activate is offered on a planned session and Close on the
 * active one, the only states the server accepts each from; Clone (next year from this one) on
 * any.
 */
export function useSessionColumns(
  { canCreate, canUpdate, canActivate, canClose }: SessionColumnPermissions,
  { onEdit, onLifecycle, onClone }: SessionColumnHandlers,
): ColumnDef<AcademicSessionRecord>[] {
  const t = useTranslations("school");
  const locale = useLocale();

  return useMemo<ColumnDef<AcademicSessionRecord>[]>(
    () => [
      {
        id: SESSION_TERMS_COLUMN_ID,
        header: () => <span className="sr-only">{t("terms.title")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            aria-expanded={row.getIsExpanded()}
            aria-label={t(row.getIsExpanded() ? "terms.hide" : "terms.show", {
              name: row.original.name,
            })}
            onClick={row.getToggleExpandedHandler()}
          >
            <ChevronRight
              className={cn("size-4 transition-transform", row.getIsExpanded() && "rotate-90")}
              aria-hidden="true"
            />
          </Button>
        ),
        meta: {
          headerTitle: t("terms.title"),
          skeleton: <Skeleton className="size-7 rounded-md" />,
          expandedContent: (session) => (
            <SessionTermsPanel session={session} canCreate={canCreate} canUpdate={canUpdate} />
          ),
        },
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.name")} />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        meta: { headerTitle: t("fields.name"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "dates",
        accessorKey: "start_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("sessions.columns.dates")} />
        ),
        cell: ({ row }) =>
          t("sessions.range", {
            start: formatDate(row.original.start_date, locale),
            end: formatDate(row.original.end_date, locale),
          }),
        meta: {
          headerTitle: t("sessions.columns.dates"),
          skeleton: <Skeleton className="h-4 w-48" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("fields.status"),
        cell: ({ row }) => <SessionStatusBadges session={row.original} />,
        meta: {
          headerTitle: t("fields.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: STRUCTURE_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const session = row.original;
          const actionLabel = (action: "activate" | "close" | "clone") =>
            t(`sessions.actions.${action}Row`, { name: session.name });
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <RowEditRemoveActions
                editLabel={
                  canUpdate && !LOCKED_SESSION_STATUSES.includes(session.status)
                    ? t("actions.editRow", { name: session.name })
                    : undefined
                }
                onEdit={() => {
                  onEdit(session);
                }}
              />
              {canActivate && session.status === "planned" && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={actionLabel("activate")}
                  onClick={() => {
                    onLifecycle(session, "activate");
                  }}
                >
                  {t("sessions.actions.activate")}
                </Button>
              )}
              {canClose && session.status === "active" && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={actionLabel("close")}
                  onClick={() => {
                    onLifecycle(session, "close");
                  }}
                >
                  {t("sessions.actions.close")}
                </Button>
              )}
              {canCreate && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={actionLabel("clone")}
                  onClick={() => {
                    onClone(session);
                  }}
                >
                  {t("sessions.actions.clone")}
                </Button>
              )}
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-24 rounded-md" /> },
      },
    ],
    [t, locale, canCreate, canUpdate, canActivate, canClose, onEdit, onLifecycle, onClone],
  );
}
