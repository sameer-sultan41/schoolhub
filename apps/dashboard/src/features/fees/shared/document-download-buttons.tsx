"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { Download } from "lucide-react";

import { saveBlob } from "@/lib/helpers";
import { DOCUMENT_LAYOUTS, type DocumentLayout } from "./document-layouts";

export interface DocumentDownloadButtonsProps {
  /** The document's number, for the buttons' names and the saved file's name. */
  label: string;
  /** Streams the document in one layout (`Services.receipts.downloadReceipt`, `downloadVoucher`). */
  download: (layout: DocumentLayout) => Promise<Blob>;
}

/**
 * A row's PDF and thermal downloads: each streams the file with the bearer token and saves it
 * (a bare anchor would send none). One download at a time; a failure says so in a toast and the
 * buttons stay usable.
 */
export function DocumentDownloadButtons({ label, download }: DocumentDownloadButtonsProps) {
  const t = useTranslations("fees.payments.download");
  const [busy, setBusy] = useState<DocumentLayout | null>(null);

  async function run(layout: DocumentLayout) {
    setBusy(layout);
    try {
      saveBlob(await download(layout), `${label}-${layout}.pdf`);
    } catch {
      toast.error(t("failed", { label }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {DOCUMENT_LAYOUTS.map((layout) => (
        <Button
          key={layout}
          type="button"
          variant="outline"
          size="sm"
          isLoading={busy === layout}
          loadingLabel={t("preparing")}
          disabled={busy !== null}
          aria-label={t(`${layout}Label`, { label })}
          onClick={() => {
            void run(layout);
          }}
        >
          <Download aria-hidden="true" />
          {t(layout)}
        </Button>
      ))}
    </div>
  );
}
