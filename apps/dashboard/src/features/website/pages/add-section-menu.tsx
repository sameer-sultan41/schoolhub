"use client";

import { useTranslations } from "next-intl";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@schoolhub/ui";
import { Plus } from "lucide-react";

import type { SectionType } from "@/services";
import { MAX_SECTIONS_PER_PAGE } from "@/services/modules/website/website-pages/website-pages-constant";

export interface AddSectionMenuProps {
  /** The active theme's section types the API accepts, in the theme's order. */
  types: readonly SectionType[];
  labelOf: (type: string) => string;
  count: number;
  disabled: boolean;
  onAdd: (type: SectionType) => void;
}

/** "Add section": a menu of the active theme's section types (decision 6), so a new theme's
 * types appear with no dashboard change. Held at the page's section limit. */
export function AddSectionMenu({ types, labelOf, count, disabled, onAdd }: AddSectionMenuProps) {
  const t = useTranslations("website.pages.editor");
  const atLimit = count >= MAX_SECTIONS_PER_PAGE;

  return (
    <div className="space-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled || atLimit || types.length === 0}>
            <Plus aria-hidden="true" />
            {t("add")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {types.map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() => {
                onAdd(type);
              }}
            >
              {labelOf(type)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          {t("limit", { max: MAX_SECTIONS_PER_PAGE })}
        </p>
      ) : null}
    </div>
  );
}
