"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import type { GradingScaleRecord } from "@/services";
import { GradeBandsEditor } from "./grade-bands-editor";

export interface GradeBandsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scale: GradingScaleRecord;
}

/** The band editor of one grading scale, in a dialog (a bottom drawer on mobile). The caller
 * mounts it only while open, so the editor and its inline form start fresh each time. */
export function GradeBandsDialog({ open, onOpenChange, scale }: GradeBandsDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-3xl" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("gradingScales.bands.titleNamed", { name: scale.name })}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="max-h-[70vh] overflow-y-auto pe-1">
          <GradeBandsEditor scale={scale} />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon("close")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
