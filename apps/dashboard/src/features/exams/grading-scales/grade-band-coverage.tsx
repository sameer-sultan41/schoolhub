"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@schoolhub/ui";

import type { CoverageIssue } from "@/services";

function IssueText({ issue }: { issue: CoverageIssue }) {
  const t = useTranslations("exams");
  switch (issue.kind) {
    case "empty":
      return t("gradingScales.bands.coverage.empty");
    case "start":
      return t("gradingScales.bands.coverage.start", { at: issue.at });
    case "end":
      return t("gradingScales.bands.coverage.end", { at: issue.at });
    case "gap":
      return t("gradingScales.bands.coverage.gap", {
        lower: issue.lower,
        upper: issue.upper,
        from: issue.from,
        to: issue.to,
      });
    case "overlap":
      return t("gradingScales.bands.coverage.overlap", {
        lower: issue.lower,
        upper: issue.upper,
        from: issue.from,
        to: issue.to,
      });
  }
}

/**
 * The advisory coverage check's result: what the bands leave ungraded or share, or that they
 * cover 0 to 100. Advisory only, since a scale is built a band at a time; the server refuses an
 * incomplete scale where an exam attaches it.
 */
export function GradeBandCoverage({ issues }: { issues: readonly CoverageIssue[] }) {
  const t = useTranslations("exams");

  if (issues.length === 0) {
    return (
      <Alert variant="success" appearance="light">
        <AlertDescription>{t("gradingScales.bands.coverage.complete")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="warning" appearance="light">
      <AlertDescription>
        <p className="font-medium">{t("gradingScales.bands.coverage.title")}</p>
        <ul className="mt-1 list-disc ps-5">
          {issues.map((issue, index) => (
            <li key={`${issue.kind}-${index}`}>
              <IssueText issue={issue} />
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
