"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

export interface CursorPagerProps {
  /** The navigation's accessible name, e.g. "Records pages". */
  label: string;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Holds both buttons while a page is loading. */
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** Previous and Next for a cursor-paginated list (`useCursorStack`): no page numbers or total,
 * as a cursor list has neither. */
export function CursorPager({
  label,
  hasPrevious,
  hasNext,
  disabled,
  onPrevious,
  onNext,
}: CursorPagerProps) {
  const tCommon = useTranslations("common");

  return (
    <nav aria-label={label} className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={!hasPrevious || disabled} onClick={onPrevious}>
        {tCommon("previous")}
      </Button>
      <Button variant="outline" size="sm" disabled={!hasNext || disabled} onClick={onNext}>
        {tCommon("next")}
      </Button>
    </nav>
  );
}
