"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { Check, Copy } from "lucide-react";

/** How long the tick stays after a copy. */
const COPIED_MS = 2000;

export interface CopyButtonProps {
  value: string;
  /** The accessible name, e.g. "Copy the TXT record's value". */
  label: string;
}

/** An icon button that puts `value` on the clipboard, with a tick and a toast; a browser that
 * refuses the clipboard gets a toast saying to copy by hand. */
export function CopyButton({ value, label }: CopyButtonProps) {
  const t = useTranslations("website.copy");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast.error(t("failed"));
      return;
    }
    setCopied(true);
    toast.success(t("done"));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      mode="icon"
      size="sm"
      aria-label={label}
      onClick={() => {
        void copy();
      }}
    >
      {copied ? <Check className="text-success" aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  );
}
