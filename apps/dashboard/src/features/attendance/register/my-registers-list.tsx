"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { CalendarCheck, CircleCheck } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import type { MyRegister } from "@/services";
import { toShortTime } from "@/services/modules/periods/periods-helper";

export interface MyRegistersListProps {
  registers: MyRegister[] | undefined;
  isError: boolean;
  onRetry: () => void;
  onOpen: (register: MyRegister) => void;
}

/** A register's own key: a teacher can take several periods of one section in a day (L8). */
export function myRegisterKey(register: MyRegister): string {
  return `${register.section_id}:${register.period_id ?? ""}`;
}

/** "Grade 5 · A", with the period in period mode: the register's name. */
export function useMyRegisterLabel() {
  const t = useTranslations("attendance");
  return (register: MyRegister) => {
    const section = t("register.mine.sectionLabel", {
      className: register.class_name,
      section: register.section_name,
    });
    return register.period_name
      ? t("register.mine.periodLabel", { section, period: register.period_name })
      : section;
  };
}

/**
 * The registers the viewer takes on the date, each with how many of its students are marked,
 * opening that register. Empty for someone who class-teaches nothing and has no lesson that
 * day; they can still pick a register above.
 */
export function MyRegistersList({ registers, isError, onRetry, onOpen }: MyRegistersListProps) {
  const t = useTranslations("attendance");
  const labelOf = useMyRegisterLabel();

  if (registers === undefined) {
    if (isError) return <LoadErrorCard message={t("register.mine.loadError")} onRetry={onRetry} />;
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("register.mine.loading")}</span>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (registers.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarCheck}
          title={t("register.mine.emptyTitle")}
          description={t("register.mine.empty")}
        />
      </Card>
    );
  }

  return (
    <section aria-label={t("register.mine.title")} className="space-y-3">
      <h2 className="text-base font-semibold">{t("register.mine.title")}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {registers.map((register) => {
          const label = labelOf(register);
          const done = register.roster_count > 0 && register.marked_count >= register.roster_count;
          return (
            <li key={myRegisterKey(register)}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="space-y-1">
                    <p className="font-medium">{label}</p>
                    {register.start_time && register.end_time && (
                      <p className="text-xs text-muted-foreground">
                        {t("register.mine.time", {
                          start: toShortTime(register.start_time),
                          end: toShortTime(register.end_time),
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular-nums">
                      {t("register.mine.marked", {
                        marked: register.marked_count,
                        total: register.roster_count,
                      })}
                    </span>
                    {done && (
                      <Badge variant="success" appearance="light">
                        <CircleCheck aria-hidden="true" />
                        {t("register.mine.done")}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="mt-auto self-start"
                    aria-label={t("register.mine.openLabel", { name: label })}
                    onClick={() => {
                      onOpen(register);
                    }}
                  >
                    {t("register.mine.open")}
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
