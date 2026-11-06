"use client";

import { useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, Button, Checkbox, Label, Textarea } from "@schoolhub/ui";

import { AttachmentUploader, type UploadedAttachment } from "@/components/attachment-uploader";
import { useCurrentUser } from "@/hooks/use-current-user";
import { HTTP_STATUS_CONFLICT } from "@/lib/constants";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { ApiError, Services } from "@/services";
import {
  THREAD_ATTACHMENT_MAX_FILES,
  THREAD_ATTACHMENT_PURPOSE,
} from "@/services/modules/files/files-constant";
import { MESSAGE_BODY_MAX_LENGTH } from "@/services/modules/message-threads/message-threads-constant";

import { useInvalidateThreads } from "./use-invalidate-threads";

export interface ReplyComposerProps {
  threadId: string;
  /** A closed thread takes no reply: sending is disabled (the thread view offers Reopen). */
  isClosed: boolean;
  /** The parent portal: a reply can carry files (a guardian may upload them). */
  allowAttachments?: boolean;
}

/**
 * The reply box under a conversation. The "Internal note" flag is offered to staff only,
 * read from `/auth/me`'s `is_restricted_principal`; the server's `422` for a guardian's or
 * student's internal note stays the enforcement.
 */
export function ReplyComposer({
  threadId,
  isClosed,
  allowAttachments = false,
}: ReplyComposerProps) {
  const t = useTranslations("communication.messages.composer");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const invalidate = useInvalidateThreads();
  const [body, setBody] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const canWriteInternalNote = user?.is_restricted_principal === false;

  const send = useMutation({
    mutationFn: () =>
      Services.messageThreads.postMessage(threadId, {
        body: body.trim(),
        is_internal_note: canWriteInternalNote && isInternalNote,
        ...(attachments.length > 0 ? { attachments: attachments.map((item) => item.id) } : {}),
      }),
    onSuccess: () => {
      setBody("");
      setIsInternalNote(false);
      setAttachments([]);
      invalidate();
    },
    onError: (error) => {
      // A 409 means the thread was closed meanwhile: reload it so the header and Reopen show.
      if (error instanceof ApiError && error.status === HTTP_STATUS_CONFLICT) invalidate();
    },
  });

  const canSend = !isClosed && body.trim().length > 0 && !send.isPending && !isUploading;

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (canSend) send.mutate();
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-3">
      {send.isError && (
        <Alert variant="destructive">
          {resolveErrorMessage(foldUnknownFieldErrors(send.error), tErrors, t("failed"), NON_FIELD)}
        </Alert>
      )}
      <Textarea
        aria-label={t("label")}
        placeholder={t("placeholder")}
        maxLength={MESSAGE_BODY_MAX_LENGTH}
        rows={3}
        disabled={isClosed}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
        }}
      />
      {allowAttachments && (
        <AttachmentUploader
          purpose={THREAD_ATTACHMENT_PURPOSE}
          label={t("attachments")}
          value={attachments}
          onChange={setAttachments}
          onUploadingChange={setIsUploading}
          multiple
          maxFiles={THREAD_ATTACHMENT_MAX_FILES}
          disabled={isClosed || send.isPending}
        />
      )}
      <div className="flex items-center gap-3">
        {canWriteInternalNote && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`internal-note-${threadId}`}
              checked={isInternalNote}
              disabled={isClosed}
              onCheckedChange={(checked) => {
                setIsInternalNote(checked === true);
              }}
            />
            <Label htmlFor={`internal-note-${threadId}`}>{t("internalNote")}</Label>
          </div>
        )}
        <Button
          type="submit"
          className="ms-auto"
          disabled={!canSend}
          isLoading={send.isPending}
          loadingLabel={t("sending")}
        >
          {t("send")}
        </Button>
      </div>
    </form>
  );
}
