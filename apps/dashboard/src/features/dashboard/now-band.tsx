"use client";

import { Badge, Card, CardContent, EmptyState } from "@schoolhub/ui";
import { CalendarOff } from "lucide-react";
import { m } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { markerPercent, useSchoolDay } from "@/features/dashboard/use-school-day";
import { useSession } from "@/hooks/use-session";

/** Widths of the placeholder strip, in the same flex-grow units a real day uses. */
const SKELETON_WEIGHTS = [45, 45, 15, 45, 45, 30, 45];

/** ~700ms, eased out: long enough to read as a sweep across the day, short enough not to delay it. */
const MARKER_TRANSITION = { duration: 0.7, ease: "easeOut" } as const;

/**
 * The bell-schedule band — the one bold element on the home screen, and the one place
 * `bg-spotlight` is spent.
 *
 * It answers the question the old stat grid never did: *what is happening right now*.
 * The strip is a true proportional timeline — every block is flex-grow weighted by its
 * own duration, so a 15-minute break is visibly a sliver next to a 45-minute lesson
 * rather than an equal-width box that lies about the shape of the day.
 *
 * The marker's inset is logical (`insetInlineStart`), not `left`, so the whole timeline
 * mirrors under `ur` without a second code path — and it is the one orchestrated motion
 * moment in the app: on load it sweeps from the start of the day to now.
 * `providers.tsx` mounts `MotionConfig reducedMotion="user"`, so a reader who has asked
 * for less motion gets the final position immediately with nothing here to remember.
 *
 * `m`, never `motion`: `LazyMotion … strict` makes the full component a runtime error
 * rather than a silent 34kb regression.
 *
 * Nothing here takes `role="status"`. The app shell's impersonation banner already owns
 * that role, and `dashboard.page.ts` locates it with `getByRole("status")` — a second
 * one is a Playwright strict-mode violation, not a stylistic preference.
 */
export function NowBand() {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const { user } = useSession();
  const { day, now, isPending, canView, error } = useSchoolDay();

  if (!canView) return null;

  const currentBlock = day.blocks.find((block) => block.key === day.currentBlockKey) ?? null;
  const greetingName = user?.full_name.trim().split(/\s+/)[0] ?? null;

  return (
    <Card tone="spotlight" elevation="raised" className="overflow-hidden">
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1">
          {greetingName ? (
            <p className="font-heading text-xl font-semibold">
              {t("welcome", { name: greetingName })}
            </p>
          ) : null}
          <p className="text-sm text-primary-foreground/75">
            {format.dateTime(now, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        {error ? (
          <ApiErrorAlert error={error} />
        ) : isPending ? (
          <div aria-busy="true" className="flex items-end gap-1">
            {SKELETON_WEIGHTS.map((weight, index) => (
              <span
                key={`band-${String(index)}`}
                style={{ flexGrow: weight }}
                className="h-3 basis-0 animate-pulse rounded-full bg-primary-foreground/25"
              />
            ))}
          </div>
        ) : day.blocks.length === 0 ? (
          // On its own surface inside the gradient: EmptyState resolves its type through
          // the foreground tokens, which are set for the page, not for the spotlight.
          <div className="rounded-[var(--sh-radius)] bg-surface text-surface-foreground">
            <EmptyState
              icon={CalendarOff}
              tone="info"
              title={t("nowBand.emptyTitle")}
              description={t("nowBand.emptyDescription")}
              className="border-transparent"
              action={
                <Link
                  href="/timetable/my"
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("nowBand.viewTimetable")}
                </Link>
              }
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <ol aria-label={t("nowBand.scheduleLabel")} className="flex items-end gap-1">
                {day.blocks.map((block) => {
                  const isCurrent = block.key === day.currentBlockKey;
                  return (
                    <li
                      key={block.key}
                      // "time", not "true": this is the block the clock is inside, which
                      // is exactly what aria-current="time" means.
                      aria-current={isCurrent ? "time" : undefined}
                      style={{ flexGrow: block.endMinutes - block.startMinutes }}
                      className="min-w-0 basis-0 space-y-1.5"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          isCurrent
                            ? "block h-4 rounded-full bg-primary-foreground"
                            : block.isBreak
                              ? // Breaks read as gaps: narrower, and unfilled.
                                "block h-1.5 rounded-full bg-primary-foreground/20"
                              : "block h-3 rounded-full bg-primary-foreground/55"
                        }
                      />
                      <span
                        className={
                          isCurrent
                            ? "block truncate text-[11px] font-semibold"
                            : "block truncate text-[11px] text-primary-foreground/70"
                        }
                      >
                        {block.label}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <m.span
                aria-hidden="true"
                data-testid="now-marker"
                className="pointer-events-none absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full bg-accent rtl:translate-x-1/2"
                initial={{ insetInlineStart: "0%" }}
                animate={{ insetInlineStart: `${String(markerPercent(day))}%` }}
                transition={MARKER_TRANSITION}
              />
            </div>

            {currentBlock ? (
              <div className="rounded-[var(--sh-radius)] bg-primary-foreground/10 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-transparent bg-accent text-accent-foreground">
                    {t("nowBand.now")}
                  </Badge>
                  <p className="font-medium">{currentBlock.label}</p>
                  {currentBlock.isSubstituted ? (
                    <Badge variant="info">{t("nowBand.substituted")}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-primary-foreground/80">
                  {currentBlock.detail ??
                    (currentBlock.isBreak ? t("nowBand.break") : t("nowBand.free"))}
                </p>
              </div>
            ) : (
              <p className="text-sm text-primary-foreground/75">{t("nowBand.between")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
