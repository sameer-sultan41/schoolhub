"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";
import { Upload } from "lucide-react";

import { useContentErrors } from "@/features/website/shared/content-errors";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { ApiError, Services } from "@/services";
import {
  WEBSITE_MEDIA_MIME_TYPES,
  WEBSITE_MEDIA_PURPOSE,
} from "@/services/modules/files/files-constant";
import { GALLERY_MEDIA_IMAGE } from "@/services/modules/website/gallery-albums/gallery-albums-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";

const ACCEPT = WEBSITE_MEDIA_MIME_TYPES.join(",");

interface Progress {
  done: number;
  total: number;
}

/**
 * "Upload photos": several files picked at once, each uploaded (`website.media`) and added to
 * the album as a photo, one after another so they keep the order they were picked in. Each
 * failure is listed with its file's name and its own reason; the rest still land. Progress
 * reports to `onBusyChange`, which holds the album's reorder while items are being added.
 */
export function GalleryUpload({
  albumId,
  onBusyChange,
}: {
  albumId: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations("website.gallery.items");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const { localise } = useContentErrors();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  // Set inside the effect, not at init, so React's dev-mode remount restores it.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function reasonOf(error: unknown): string {
    if (error instanceof ApiError) {
      return resolveErrorMessage(
        foldUnknownFieldErrors(localise(error)),
        tErrors,
        tCommon("submitFailed"),
        NON_FIELD,
      );
    }
    // `FileUploadError`'s message is already specific: the server's refusal or the failed step.
    return error instanceof Error ? error.message : tCommon("submitFailed");
  }

  async function uploadAll(files: File[]) {
    const failed: string[] = [];
    let added = 0;
    onBusyChange(true);
    setFailures([]);
    setProgress({ done: 0, total: files.length });
    for (const [index, file] of files.entries()) {
      try {
        const fileId = await Services.files.uploadFile(file, WEBSITE_MEDIA_PURPOSE);
        await Services.galleryAlbums.createGalleryItem(albumId, {
          media_type: GALLERY_MEDIA_IMAGE,
          file_id: fileId,
        });
        added += 1;
      } catch (error) {
        failed.push(t("uploadFailed", { name: file.name, reason: reasonOf(error) }));
      }
      if (!mountedRef.current) return;
      setProgress({ done: index + 1, total: files.length });
    }
    invalidateWebsite();
    setProgress(null);
    setFailures(failed);
    onBusyChange(false);
    if (added > 0) toast.success(t("uploadDone", { count: added }));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Lets the same files be picked again after a failure: an unchanged value fires no event.
    event.target.value = "";
    if (files.length > 0) void uploadAll(files);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={progress !== null}
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          <Upload aria-hidden="true" />
          {t("upload")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label={t("upload")}
          onChange={handleChange}
        />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {progress ? t("uploading", progress) : null}
        </p>
      </div>
      {failures.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc ps-5">
              {failures.map((failure, index) => (
                // Two files may share a name and a reason; the list's order is their identity.
                <li key={index}>{failure}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
