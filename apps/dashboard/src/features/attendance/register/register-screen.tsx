"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, Card, EmptyState, Skeleton } from "@schoolhub/ui";
import { ArrowLeft, Clock } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useUrlParams } from "@/hooks/use-url-params";
import { isIsoDate, isUuid, todayIsoDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type MyRegister } from "@/services";
import {
  DAILY_ATTENDANCE_MODE,
  PERIOD_ATTENDANCE_MODE,
} from "@/services/modules/attendance-settings/attendance-settings-constant";
import {
  MY_REGISTERS_RESOURCE,
  REGISTER_URL_KEYS,
  STUDENT_ATTENDANCE_QUERY_MODULE,
} from "@/services/modules/student-attendance/student-attendance-constant";
import { MyRegistersList, useMyRegisterLabel } from "./my-registers-list";
import { RegisterPickers } from "./register-pickers";
import { RegisterTable } from "./register-table";

/** A URL id, or `""` when it is missing or isn't a UUID (never sent to the API). */
function urlId(value: string | null): string {
  return value && isUuid(value) ? value : "";
}

/**
 * `/attendance/register`: the date (today by default), then My registers for it, or the
 * register picked from them or from the pickers. Which register is open lives in the URL, so a
 * reload keeps it and a link shares it. The mode comes from `my-registers`' meta, which every
 * marker can read: in period mode a register needs its period, and a period left in the URL
 * after a switch back to daily is ignored.
 */
export function RegisterScreen() {
  const t = useTranslations("attendance");
  const labelOf = useMyRegisterLabel();
  const { searchParams, setParams } = useUrlParams();
  const dateParam = searchParams.get(REGISTER_URL_KEYS.date) ?? "";
  const date = isIsoDate(dateParam) ? dateParam : todayIsoDate();
  const classId = urlId(searchParams.get(REGISTER_URL_KEYS.class));
  const sectionId = urlId(searchParams.get(REGISTER_URL_KEYS.section));
  const periodParam = urlId(searchParams.get(REGISTER_URL_KEYS.period));

  const myRegistersQuery = useQuery({
    queryKey: queryKeys.list(STUDENT_ATTENDANCE_QUERY_MODULE, MY_REGISTERS_RESOURCE, { date }),
    queryFn: () => Services.studentAttendance.fetchMyRegisters(date),
  });
  const mode = myRegistersQuery.data?.attendanceMode;
  const registers = myRegistersQuery.data?.registers;
  const periodMode = mode === PERIOD_ATTENDANCE_MODE;
  const periodId = mode === DAILY_ATTENDANCE_MODE ? "" : periodParam;
  const sameSection = (register: MyRegister) => register.section_id === sectionId;
  const openRegister = registers?.find(
    (register) => sameSection(register) && (register.period_id ?? "") === periodId,
  );
  const campusIdHint = (openRegister ?? registers?.find(sameSection))?.campus_id ?? "";

  function openFromList(register: MyRegister) {
    // My registers names no class: the pickers drop theirs rather than show a stale one.
    setParams({
      [REGISTER_URL_KEYS.class]: null,
      [REGISTER_URL_KEYS.section]: register.section_id,
      [REGISTER_URL_KEYS.period]: register.period_id,
    });
  }

  function backToMine() {
    setParams({
      [REGISTER_URL_KEYS.class]: null,
      [REGISTER_URL_KEYS.section]: null,
      [REGISTER_URL_KEYS.period]: null,
    });
  }

  function body() {
    if (sectionId === "") {
      return (
        <MyRegistersList
          registers={registers}
          isError={myRegistersQuery.isError}
          onRetry={() => {
            void myRegistersQuery.refetch();
          }}
          onOpen={openFromList}
        />
      );
    }
    // Until the mode is known a period register can't be asked for the right way.
    if (myRegistersQuery.isPending) return <Skeleton className="h-96 w-full" />;
    if (periodMode && periodId === "") {
      return (
        <Card>
          <EmptyState
            icon={Clock}
            title={t("register.pickPeriodTitle")}
            description={t("register.pickPeriod")}
          />
        </Card>
      );
    }
    return (
      <RegisterTable
        key={`${sectionId}:${date}:${periodId}`}
        sectionId={sectionId}
        date={date}
        periodId={periodId}
        heading={openRegister ? labelOf(openRegister) : undefined}
      />
    );
  }

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("register.title")} description={t("register.summary")} />
        {sectionId !== "" && (
          <ToolbarActions>
            <Button variant="outline" onClick={backToMine}>
              <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
              {t("register.backToMine")}
            </Button>
          </ToolbarActions>
        )}
      </Toolbar>
      <div className="space-y-4">
        <RegisterPickers
          date={date}
          classId={classId}
          sectionId={sectionId}
          periodId={periodId}
          periodMode={periodMode}
          campusIdHint={campusIdHint}
          onChange={setParams}
        />
        {body()}
      </div>
    </>
  );
}
