"use client";

import { useTranslations } from "next-intl";
import { Card, EmptyState } from "@schoolhub/ui";
import { CalendarX } from "lucide-react";

import type { AcademicSessionSummary } from "@/services";
import { SessionPicker } from "./session-picker";

export interface NoSessionCardProps {
  sessions: AcademicSessionSummary[] | undefined;
  /** Called with the picked session's id, or `""` for the current session (the URL default). */
  onPick: (sessionId: string) => void;
}

/**
 * What an Academics list shows when no session resolves (no current one, none picked): a
 * `SessionPicker`, so the viewer can pick from the sessions there are, above an empty state.
 */
export function NoSessionCard({ sessions, onPick }: NoSessionCardProps) {
  const t = useTranslations("academics");

  return (
    <Card>
      <div className="flex flex-col gap-4 p-6">
        <SessionPicker sessions={sessions} value="" onChange={onPick} className="w-full sm:w-60" />
        <EmptyState
          icon={CalendarX}
          title={t("common.noSessionTitle")}
          description={t("common.noSessionDescription")}
        />
      </div>
    </Card>
  );
}
