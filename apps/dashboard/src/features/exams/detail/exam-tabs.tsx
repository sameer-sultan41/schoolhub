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
import { MarksTab } from "@/features/exams/marks/marks-tab";
import { ReportCardsTab } from "@/features/exams/report-cards/report-cards-tab";
import { ResultsTab } from "@/features/exams/results/results-tab";
import { ADMIT_CARD_URL_FILTERS } from "@/services/modules/admit-cards/admit-cards-constant";
import {
  RESULT_URL_FILTERS,
  RESULTS_TAB_ID,
} from "@/services/modules/exam-results/exam-results-constant";
import { EXAM_TAB_URL_KEY } from "@/services/modules/exams/exams-constant";
import {
  REPORT_CARD_URL_FILTERS,
  REPORT_CARDS_TAB_ID,
} from "@/services/modules/report-cards/report-cards-constant";
import {
  MARKS_SECTION_URL_KEY,
  MARKS_SUBJECT_URL_KEY,
  MARKS_TAB_ID,
} from "@/services/modules/marks/marks-constant";
import { ScheduleTab } from "@/features/exams/schedule/schedule-tab";
import { ExamSubjectsTable } from "@/features/exams/subjects/exam-subjects-table";

/** The URL keys a tab owns: its list filters, and the marks grid's subject and section. */
const TAB_SCOPED_URL_KEYS = [
  MARKS_SUBJECT_URL_KEY,
  MARKS_SECTION_URL_KEY,
  ...Object.keys(ADMIT_CARD_URL_FILTERS),
  ...Object.keys(RESULT_URL_FILTERS),
  ...Object.keys(REPORT_CARD_URL_FILTERS),
];

export interface ExamTabSpec {
  id: string;
  /** The key that shows this tab; the API enforces it too. */
  permission: PermissionKey;
}

/** Every tab an exam page has, in order, each on its permission key. A tab draws only once it
 * has content in `EXAM_TAB_CONTENT`. */
export const EXAM_TABS = [
  { id: "subjects", permission: "exams.exam.view" },
  { id: "schedule", permission: "exams.schedule.view" },
  { id: "admit-cards", permission: "exams.admit-card.view" },
  { id: MARKS_TAB_ID, permission: "exams.marks.view" },
  { id: RESULTS_TAB_ID, permission: "exams.result.view" },
  { id: REPORT_CARDS_TAB_ID, permission: "exams.report-card.view" },
] as const satisfies readonly ExamTabSpec[];

export type ExamTabId = (typeof EXAM_TABS)[number]["id"];

/** A tab's content, given the exam. A tab with no entry here is not drawn. */
export const EXAM_TAB_CONTENT: Partial<Record<ExamTabId, ComponentType<{ exam: ExamRecord }>>> = {
  subjects: ExamSubjectsTable,
  schedule: ScheduleTab,
  "admit-cards": AdmitCardsTab,
  [MARKS_TAB_ID]: MarksTab,
  [RESULTS_TAB_ID]: ResultsTab,
  [REPORT_CARDS_TAB_ID]: ReportCardsTab,
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
        // The first tab is the URL's default, so it leaves the key out. Every other key belongs to
        // the tab that wrote it (the marks grid's subject and section, a list's filters): the next
        // tab must not read them, since Admit cards, Results and Report cards all take `section`
        // as a filter and `status` means a different set of values on each.
        setParams({
          [EXAM_TAB_URL_KEY]: value === first.id ? null : value,
          ...Object.fromEntries(TAB_SCOPED_URL_KEYS.map((key) => [key, null])),
        });
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
