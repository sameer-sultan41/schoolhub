"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Skeleton } from "@schoolhub/ui";
import { Ban, Download } from "lucide-react";

import { EMPTY_VALUE } from "@/lib/constants";
import type { AdmitCardRecord } from "@/services";
import { ADMIT_CARD_ACTIONS_COLUMN_ID } from "@/services/modules/admit-cards/admit-cards-constant";
import {
  isCardDownloadable,
  isCardRevoked,
} from "@/services/modules/admit-cards/admit-cards-helper";
import { AdmitCardStatusBadge } from "./admit-card-status-badge";

export interface AdmitCardColumnsOptions {
  /** `exams.admit-card.issue`: Revoke shows on a live card. */
  canRevoke: boolean;
  /** The card whose link is being fetched: its Download is held. */
  downloadingId: string | null;
  /** Both must be `useCallback`-stable, or the columns rebuild on every render. */
  onDownload: (card: AdmitCardRecord) => void;
  onRevoke: (card: AdmitCardRecord) => void;
}

/**
 * The Admit cards tab's columns: number, student, admission number, section, status (a revoked
 * card's reason under it) and the row's actions. Download shows only once the render job wrote a
 * PDF and no revocation withdrew it, the server's own rule for `:download`.
 */
export function useAdmitCardColumns({
  canRevoke,
  downloadingId,
  onDownload,
  onRevoke,
}: AdmitCardColumnsOptions): ColumnDef<AdmitCardRecord>[] {
  const t = useTranslations("exams");

  return useMemo<ColumnDef<AdmitCardRecord>[]>(
    () => [
      {
        id: "number",
        enableSorting: false,
        header: () => t("admitCards.columns.number"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.admit_card_no}</span>,
        meta: {
          headerTitle: t("admitCards.columns.number"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "student",
        enableSorting: false,
        header: () => t("admitCards.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("admitCards.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "admissionNumber",
        enableSorting: false,
        header: () => t("admitCards.columns.admissionNumber"),
        cell: ({ row }) => row.original.admission_number,
        meta: {
          headerTitle: t("admitCards.columns.admissionNumber"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        // Blank for a student with no active enrollment in the exam's session.
        id: "section",
        enableSorting: false,
        header: () => t("admitCards.columns.section"),
        cell: ({ row }) => row.original.section_name ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("admitCards.columns.section"),
          skeleton: <Skeleton className="h-4 w-12" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("admitCards.columns.status"),
        cell: ({ row }) => {
          const card = row.original;
          return (
            <span className="flex flex-col items-start gap-1">
              <AdmitCardStatusBadge status={card.status} />
              {isCardRevoked(card) && card.revoked_reason !== null && (
                <span className="text-xs text-muted-foreground">
                  {t("admitCards.revokedReason", { reason: card.revoked_reason })}
                </span>
              )}
            </span>
          );
        },
        meta: {
          headerTitle: t("admitCards.columns.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: ADMIT_CARD_ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("admitCards.columns.actions")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const card = row.original;
          const name = { name: card.student_name };
          return (
            <div className="flex items-center gap-1">
              {isCardDownloadable(card) && (
                <Button
                  variant="primary"
                  appearance="light"
                  mode="icon"
                  shape="circle"
                  size="sm"
                  aria-label={t("admitCards.actions.downloadRow", name)}
                  disabled={downloadingId === card.id}
                  onClick={() => {
                    onDownload(card);
                  }}
                >
                  <Download className="size-4" aria-hidden="true" />
                </Button>
              )}
              {canRevoke && !isCardRevoked(card) && (
                <Button
                  variant="destructive"
                  appearance="light"
                  mode="icon"
                  shape="circle"
                  size="sm"
                  aria-label={t("admitCards.actions.revokeRow", name)}
                  onClick={() => {
                    onRevoke(card);
                  }}
                >
                  <Ban className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, canRevoke, downloadingId, onDownload, onRevoke],
  );
}
