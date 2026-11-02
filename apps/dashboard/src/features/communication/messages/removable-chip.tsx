"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@schoolhub/ui";

export interface RemovableChipProps {
  /** The chosen recipient's or student's name. */
  label: string;
  onRemove: () => void;
  className?: string;
}

/** A picker's choice: its name and a button that removes it (the recipient and student pickers). */
export function RemovableChip({ label, onRemove, className }: RemovableChipProps) {
  const t = useTranslations("communication.messages.picker");

  return (
    <Badge variant="secondary" appearance="light" size="lg" className={className}>
      {label}
      <Button
        type="button"
        variant="ghost"
        mode="icon"
        size="sm"
        className="size-4"
        aria-label={t("remove", { name: label })}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </Badge>
  );
}
