"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { Search } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import type { SeoTarget } from "@/services";
import { SeoDialog } from "./seo-form";

export interface SeoButtonProps {
  target: SeoTarget;
  /** The record's title, named in the dialog. */
  title: string;
}

/**
 * The "SEO" action of a page's, post's, event's or album's editor: opens that record's SEO in a
 * dialog. Shown only with `website.seo.update` (the API enforces it); the record's own edit keys
 * don't matter, since SEO has its own.
 */
export function SeoButton({ target, title }: SeoButtonProps) {
  const t = useTranslations("website.seo");
  const { data: user } = useCurrentUser();
  const [open, setOpen] = useState(false);

  if (!hasPermission(user, "website.seo.update")) return null;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Search aria-hidden="true" />
        {t("action")}
      </Button>
      {open && (
        <SeoDialog
          target={target}
          title={title}
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
        />
      )}
    </>
  );
}
