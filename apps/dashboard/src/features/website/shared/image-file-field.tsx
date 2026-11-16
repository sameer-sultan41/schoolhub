"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  useWatch,
  type FieldValues,
  type Path,
  type PathValue,
  type UseFormReturn,
} from "react-hook-form";
import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { Trash2 } from "lucide-react";

import { Services } from "@/services";
import {
  WEBSITE_MEDIA_MIME_TYPES,
  WEBSITE_MEDIA_PURPOSE,
} from "@/services/modules/files/files-constant";
import { useUploadTrackerContext } from "./upload-tracker";

const ACCEPT = WEBSITE_MEDIA_MIME_TYPES.join(",");

export interface ImageFileFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** A string field holding the file id, or `""` for no image. The host omits the key (or
   * sends `null`) for `""`: the API refuses an empty id. */
  name: Path<TFieldValues>;
  label: string;
  required?: boolean;
}

/**
 * A website image: picked, uploaded through `Services.files.uploadFile` (purpose
 * `website.media`) and stored as its file id. The upload reports to the form's
 * `UploadTracker`, which holds Save and makes a submit wait for it, so a quick Save never
 * drops the picked image. A result that lands after the field unmounts (the dialog closed) is
 * dropped. The saved image has no preview URL in the CMS API, so it shows as "on file".
 */
export function ImageFileField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  required,
}: ImageFileFieldProps<TFieldValues>) {
  const t = useTranslations("website.imageField");
  const tracker = useUploadTrackerContext();
  const fileId = useWatch({ control: form.control, name }) as string | undefined;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Set inside the effect, not at init, so React's dev-mode remount restores it.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Revokes each object URL once a newer one (or none) replaces it, and the last on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function upload(file: File) {
    try {
      const id = await Services.files.uploadFile(file, WEBSITE_MEDIA_PURPOSE);
      if (!mountedRef.current) return;
      form.setValue(name, id as PathValue<TFieldValues, Path<TFieldValues>>, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setStatus("idle");
    } catch (error) {
      if (!mountedRef.current) return;
      // `FileUploadError`'s message is already specific: the server's refusal or the failed step.
      setUploadError(error instanceof Error ? error.message : t("uploadFailed"));
      setStatus("error");
      setPreviewUrl(null);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Lets the same file be picked again after a failure: an unchanged value fires no event.
    event.target.value = "";
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setStatus("uploading");
    setUploadError(null);
    const pending = upload(file);
    tracker?.track(pending);
  }

  function handleRemove() {
    setPreviewUrl(null);
    setUploadError(null);
    setStatus("idle");
    form.setValue(name, "" as PathValue<TFieldValues, Path<TFieldValues>>, { shouldDirty: true });
  }

  const hasImage = Boolean(fileId) || previewUrl !== null;

  return (
    <FormField
      control={form.control}
      name={name}
      render={() => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-3">
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt=""
                width={64}
                height={64}
                unoptimized
                className="size-16 shrink-0 rounded-md border border-border object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-1">
              <FormControl required={required}>
                <Input
                  type="file"
                  accept={ACCEPT}
                  disabled={status === "uploading"}
                  onChange={handleChange}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {status === "uploading" ? t("uploading") : hasImage ? t("onFile") : t("none")}
              </p>
              {status === "error" && uploadError ? (
                <p className="text-xs text-destructive" role="alert">
                  {uploadError}
                </p>
              ) : null}
            </div>
            {hasImage && status !== "uploading" ? (
              <Button
                type="button"
                variant="ghost"
                mode="icon"
                aria-label={t("remove")}
                title={t("remove")}
                onClick={handleRemove}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
