"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { Sparkles } from "lucide-react";

/** The "AI-generated" label ai-governance.md §8 makes mandatory wherever AI output is consumed:
 * the info token, an icon and the words, so the colour never carries it alone. */
export function AiGeneratedBadge() {
  const t = useTranslations("exams");
  return (
    <Badge variant="info" appearance="light">
      <Sparkles aria-hidden="true" />
      {t("questionBanks.questions.aiGenerated")}
    </Badge>
  );
}
