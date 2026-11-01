"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@schoolhub/ui";
import type { PermissionKey } from "@schoolhub/types";

import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { hasPermission } from "@/lib/permissions";
import type { ExamRecord } from "@/services";
import { AdmitCardsTab } from "@/features/exams/admit-cards/admit-cards-tab";
import { ScheduleTab } from "@/features/exams/schedule/schedule-tab";
import { ExamSubjectsTable } from "@/features/exams/subjects/exam-subjects-table";

/** The query-string key the open tab lives under (`?tab=`). */
export const EXAM_TAB_URL_KEY = "tab";

export interface ExamTabSpec {
  id: string;
  /** The key that shows this tab; the API enforces it too. */
  permission: PermissionKey;
}

/**
 * Every tab an exam page will have, in order, each on its permission key. A tab draws only once
 * it has content in `EXAM_TAB_CONTENT`: the later screens (marks, results, report cards) land in
 * their own changes, each adding its content below.
 */
export const EXAM_TABS = [
  { id: "subjects", permission: "exams.exam.view" },
  { id: "schedule", permission: "exams.schedule.view" },
  { id: "admit-cards", permission: "exams.admit-card.view" },
  { id: "marks", permission: "exams.marks.create" }, // PR C: exams.marks.view
  { id: "results", permission: "exams.result.view" },
  { id: "report-cards", permission: "exams.report-card.view" },
] as const satisfies readonly ExamTabSpec[];

export type ExamTabId = (typeof EXAM_TABS)[number]["id"];

/** A tab's content, given the exam. A tab with no entry here is not drawn. */
export const EXAM_TAB_CONTENT: Partial<Record<ExamTabId, ComponentType<{ exam: ExamRecord }>>> = {
  subjects: ExamSubjectsTable,
  schedule: ScheduleTab,
  "admit-cards": AdmitCardsTab,
};

/** The exam's tabs, in `?tab=`. Shows only those with content whose key the viewer holds; an
 * unknown or hidden `tab` falls back to the first shown. */
export function ExamTabs({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const { data: user } = useCurrentUser();
  const { searchParams, setParams } = useUrlParams();

  const visible = EXAM_TABS.filter(
    (tab) => EXAM_TAB_CONTENT[tab.id] !== undefined && hasPermission(user, tab.permission),
  );
  const first = visible[0];
  if (!first) return null;

  const requested = searchParams.get(EXAM_TAB_URL_KEY);
  const active = visible.find((tab) => tab.id === requested) ?? first;

  return (
    <Tabs
      value={active.id}
      onValueChange={(value) => {
        // The first tab is the URL's default, so it leaves the key out.
        setParams({ [EXAM_TAB_URL_KEY]: value === first.id ? null : value });
      }}
      className="space-y-4"
    >
      <TabsList variant="line" aria-label={t("tabs.label")}>
        {visible.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {t(`tabs.${tab.id}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {visible.map((tab) => {
        const Content = EXAM_TAB_CONTENT[tab.id];
        return (
          <TabsContent key={tab.id} value={tab.id}>
            {Content && tab.id === active.id && <Content exam={exam} />}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
