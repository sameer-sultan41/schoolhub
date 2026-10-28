"use client";

import { useTranslations } from "next-intl";
import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import type { AcademicSessionSummary } from "@/services";
import { LOCKED_SESSION_STATUSES } from "@/services/modules/school-organization/school-organization-constant";

export interface SessionPickerProps {
  sessions: AcademicSessionSummary[] | undefined;
  /** The session shown as selected: the resolved session's id, or `""` for none. */
  value: string;
  /** Called with the picked session's id, or `""` for the current session (the URL default). */
  onChange: (sessionId: string) => void;
  className?: string;
  disabled?: boolean;
}

/** Picks the academic session a session-scoped screen (Academics, Timetable) works on. Marks the current session, and
 * any whose records are read-only (closed or archived). */
export function SessionPicker({
  sessions,
  value,
  onChange,
  className,
  disabled,
}: SessionPickerProps) {
  const t = useTranslations("academicSession");
  const tCommon = useTranslations("common");

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(sessionId) => {
        const picked = sessions?.find((session) => session.id === sessionId);
        onChange(picked?.is_current ? "" : sessionId);
      }}
    >
      <SelectTrigger className={className} aria-label={t("label")}>
        <SelectValue placeholder={t("placeholder")} />
      </SelectTrigger>
      <SelectContent emptyMessage={tCommon("noOptions")}>
        {(sessions ?? []).map((session) => (
          <SelectItem key={session.id} value={session.id}>
            <span className="flex items-center gap-2">
              {session.name}
              {session.is_current && (
                <Badge size="sm" variant="primary" appearance="light">
                  {t("current")}
                </Badge>
              )}
              {LOCKED_SESSION_STATUSES.includes(session.status) && (
                <Badge size="sm" variant="secondary">
                  {t("locked")}
                </Badge>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
