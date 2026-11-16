"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@schoolhub/ui";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { resolveErrorMessage } from "@/lib/error-message";
import { Services } from "@/services";
import {
  CALENDAR_WEEKDAYS,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";

export interface WorkingDaysCardProps {
  /** The effective week the server answered (0 = Monday). */
  workingDays: readonly number[];
  canEdit: boolean;
}

/**
 * The school's working week, as day toggles and a Save. A school must open on at least one
 * day, so Save holds until one is picked; the server's own refusal shows inline. Only
 * `working_days` is sent, so the holidays list is left as stored.
 *
 * Mounting contract: the caller keys this on the saved week, so a refetch that changes it
 * starts the toggles afresh.
 */
export function WorkingDaysCard({ workingDays, canEdit }: WorkingDaysCardProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const [days, setDays] = useState<number[]>([...workingDays]);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (next: number[]) =>
      Services.schoolOrganization.updateHolidayCalendar({ working_days: next }),
    onSuccess: () => {
      invalidate();
      toast.success(t("calendar.workingDays.saved"));
    },
    onError: (mutationError) => {
      setError(
        resolveErrorMessage(mutationError, tErrors, tCommon("submitFailed"), "working_days"),
      );
    },
  });

  const unchanged =
    days.length === workingDays.length && days.every((day) => workingDays.includes(day));

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("calendar.workingDays.title")}</CardTitle>
          <CardDescription>{t("calendar.workingDays.description")}</CardDescription>
        </CardHeading>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToggleGroup
          type="multiple"
          variant="outline"
          className="flex-wrap justify-start"
          aria-label={t("calendar.workingDays.title")}
          disabled={!canEdit || mutation.isPending}
          value={days.map(String)}
          onValueChange={(picked) => {
            setDays(picked.map(Number).sort((a, b) => a - b));
          }}
        >
          {CALENDAR_WEEKDAYS.map((day) => (
            <ToggleGroupItem key={day} value={String(day)} aria-label={t(`weekdays.${day}`)}>
              {t(`weekdaysShort.${day}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {days.length === 0 ? (
          <p className="text-sm text-destructive">{t("calendar.workingDays.atLeastOne")}</p>
        ) : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </CardContent>
      {canEdit ? (
        <CardFooter className="justify-end">
          <Button
            disabled={days.length === 0 || unchanged}
            isLoading={mutation.isPending}
            loadingLabel={tCommon("saving")}
            onClick={() => {
              setError(null);
              mutation.mutate(days);
            }}
          >
            {t("calendar.workingDays.save")}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** The key that remounts the card when the saved week changes. */
export function workingDaysKey(workingDays: readonly number[]): string {
  return workingDays.join(",");
}
