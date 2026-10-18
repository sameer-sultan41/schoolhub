"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  BadgeDot,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type BadgeProps,
} from "@schoolhub/ui";

import type { PromotionDecisionRecord, PromotionExecutionReport } from "@/services";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** The report's four outcomes, in the order they read, and the colour each count wears. */
const OUTCOMES = [
  { key: "enrolled", variant: "success" },
  { key: "graduated", variant: "success" },
  { key: "skipped", variant: "warning" },
  { key: "failed", variant: "destructive" },
] as const satisfies readonly { key: keyof PromotionExecutionReport; variant: BadgeVariant }[];

function indexByStudent(decisions: readonly PromotionDecisionRecord[]) {
  const byStudent = new Map<string, PromotionDecisionRecord>();
  for (const decision of decisions) byStudent.set(decision.student_id, decision);
  return byStudent;
}

export interface PromotionExecutionReportCardProps {
  report: PromotionExecutionReport;
  /** The batch's decisions: the report names students by id, and these say who they are. */
  decisions: readonly PromotionDecisionRecord[];
}

/**
 * What executing the batch did, student by student. Each outcome gets its count; the skipped and
 * failed students are listed by name with the server's reason, because a student who didn't move
 * on must not be lost behind "3 of 30 succeeded".
 */
export function PromotionExecutionReportCard({
  report,
  decisions,
}: PromotionExecutionReportCardProps) {
  const t = useTranslations("academics");
  const studentsById = useMemo(() => indexByStudent(decisions), [decisions]);

  // A student the batch no longer lists (it was refetched meanwhile) falls back to their id.
  function studentLabel(studentId: string): string {
    const decision = studentsById.get(studentId);
    if (!decision) return studentId;
    return t("promotions.studentLabel", {
      name: decision.student_name,
      admissionNumber: decision.admission_number,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("promotions.report.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-wrap gap-2.5">
          {OUTCOMES.map(({ key, variant }) => (
            <li key={key}>
              <Badge variant={variant} appearance="light" size="lg">
                <BadgeDot />
                {t(`promotions.report.${key}`, { count: report[key].length })}
              </Badge>
            </li>
          ))}
        </ul>
        {report.skipped.length > 0 && (
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
            {report.skipped.map((entry) => (
              <li key={entry.student_id}>
                {t("promotions.report.skippedStudent", {
                  student: studentLabel(entry.student_id),
                  reason: entry.reason,
                })}
              </li>
            ))}
          </ul>
        )}
        {report.failed.length > 0 && (
          <ul className="list-disc space-y-1 ps-5 text-sm text-destructive">
            {report.failed.map((entry) => (
              <li key={entry.student_id}>
                {t("promotions.report.failedStudent", {
                  student: studentLabel(entry.student_id),
                  error: entry.error,
                })}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
