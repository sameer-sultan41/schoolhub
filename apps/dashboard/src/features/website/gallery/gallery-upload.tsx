"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";
import { Upload } from "lucide-react";

import { CONTENT_REASON_SCOPE } from "@/features/website/shared/content-fields";
import { useUploadErrorText } from "@/features/website/shared/use-upload-error-text";
import { withReasonText } from "@/features/website/shared/reason-message";
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
 * failure is listed with its file's name and its own reason; the rest still land, even if the
 * page is left meanwhile (only this component's own state stops updating; any failure is then
 * said in a toast, by file name), and the album's items are read again at the end. Progress reports to `onBusyChange`, which holds the album's
 * reorder while items are being added.
 */
export function GalleryUpload({
  albumId,
  onBusyChange,
  disabled,
  describedBy,
}: {
  albumId: string;
  onBusyChange: (busy: boolean) => void;
  /** Holds a new batch, e.g. while the album is being reordered or is full. */
  disabled: boolean;
  /** The id of the text saying why the button is held. */
  describedBy?: string;
}) {
  const t = useTranslations("website.gallery.items");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const tReasons = useTranslations("website.reasons");
  const uploadErrorText = useUploadErrorText();
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
        foldUnknownFieldErrors(withReasonText(error, tReasons, CONTENT_REASON_SCOPE)),
        tErrors,
        tCommon("submitFailed"),
        NON_FIELD,
      );
    }
    // The upload itself failed: said by the step that failed.
    return uploadErrorText(error);
  }

  async function uploadAll(files: File[]) {
    const failed: string[] = [];
    const failedNames: string[] = [];
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
        failedNames.push(file.name);
      }
      // Leaving the page doesn't stop the batch: the files picked are still added.
      if (mountedRef.current) setProgress({ done: index + 1, total: files.length });
    }
    invalidateWebsite();
    if (mountedRef.current) {
      setProgress(null);
      setFailures(failed);
      onBusyChange(false);
    } else if (failedNames.length > 0) {
      // The page that would list them is gone: the failures are said once, by name.
      toast.error(
        t("uploadFailedAfterLeave", { count: failedNames.length, names: failedNames.join(", ") }),
      );
    }
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
          disabled={disabled || progress !== null}
          aria-describedby={describedBy}
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
          {progress ? t("uploading", { done: progress.done, total: progress.total }) : null}
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
