"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Label } from "@schoolhub/ui";
import { Paperclip, X } from "lucide-react";

import { Services } from "@/services";
import {
  PORTAL_ATTACHMENT_MAX_MB,
  PORTAL_ATTACHMENT_MIME_TYPES,
} from "@/services/modules/files/files-constant";

const BYTES_PER_MB = 1024 * 1024;

/** A file already uploaded and confirmed: its id goes on the record that carries it. */
export interface UploadedAttachment {
  id: string;
  name: string;
}

export interface AttachmentUploaderProps {
  /** The registered upload purpose (`core/files/purposes.py`). */
  purpose: string;
  label: string;
  value: readonly UploadedAttachment[];
  onChange: (next: UploadedAttachment[]) => void;
  /** Lets the host hold its submit back while a file is on its way. A stable setter. */
  onUploadingChange?: (uploading: boolean) => void;
  /** More than one file; `maxFiles` then caps them. */
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  /** Set by a surrounding `FormControl` (`Slot`), which ties a field's error to the input. */
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * Picks files and uploads each straight away through `Services.files.uploadFile` (the same
 * three-step flow the photo field uses), listing what landed with a remove button. Type and size
 * are checked here for a fast answer; the server's own message is shown when it refuses.
 */
export function AttachmentUploader({
  purpose,
  label,
  value,
  onChange,
  onUploadingChange,
  multiple = false,
  maxFiles = 1,
  disabled = false,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: AttachmentUploaderProps) {
  const t = useTranslations("common.attachmentUpload");
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a still-mounted instance reports back, and the latest list wins over a stale closure.
  const mountedRef = useRef(false);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onUploadingChange?.(false);
    };
  }, [onUploadingChange]);

  const atLimit = value.length >= maxFiles;

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Lets the same file be picked again after a failure.
    event.target.value = "";
    if (!file) return;
    if (!(PORTAL_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError(t("wrongType", { name: file.name }));
      return;
    }
    if (file.size > PORTAL_ATTACHMENT_MAX_MB * BYTES_PER_MB) {
      setError(t("tooLarge", { name: file.name, max: PORTAL_ATTACHMENT_MAX_MB }));
      return;
    }

    setError(null);
    setUploading(true);
    onUploadingChange?.(true);
    let outcome: { id: string } | { message: string };
    try {
      outcome = { id: await Services.files.uploadFile(file, purpose) };
    } catch (failure) {
      // `FileUploadError`'s message is already specific: the server's text or the failed step.
      outcome = { message: failure instanceof Error ? failure.message : t("uploadFailed") };
    }
    if (!mountedRef.current) return;
    setUploading(false);
    onUploadingChange?.(false);
    if ("id" in outcome) {
      const added = { id: outcome.id, name: file.name };
      onChange(multiple ? [...valueRef.current, added] : [added]);
    } else {
      setError(outcome.message);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      {!atLimit || !multiple ? (
        <Input
          id={inputId}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          type="file"
          accept={PORTAL_ATTACHMENT_MIME_TYPES.join(",")}
          disabled={disabled || uploading}
          onChange={(event) => {
            void handlePick(event);
          }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t("limitReached", { max: maxFiles })}</p>
      )}
      {uploading ? <p className="text-xs text-muted-foreground">{t("uploading")}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {value.length > 0 ? (
        <ul className="space-y-1">
          {value.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-2 text-sm text-foreground">
              <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || uploading}
                aria-label={t("remove", { name: attachment.name })}
                onClick={() => {
                  onChange(value.filter((item) => item.id !== attachment.id));
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
