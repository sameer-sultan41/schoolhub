"use client";

import { useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, Button, Checkbox, Label, Textarea } from "@schoolhub/ui";

import { resolveErrorMessage } from "@/lib/error-message";
import { Services } from "@/services";
import { MESSAGE_BODY_MAX_LENGTH } from "@/services/modules/message-threads/message-threads-constant";

import { useRefreshThreads } from "./use-refresh-threads";

export interface ReplyComposerProps {
  threadId: string;
  /** A closed thread takes no reply: sending is disabled (the thread view offers Reopen). */
  isClosed: boolean;
}

/** The reply box under a conversation, with an "Internal note" flag only staff see. */
export function ReplyComposer({ threadId, isClosed }: ReplyComposerProps) {
  const t = useTranslations("communication.messages.composer");
  const tErrors = useTranslations("errors");
  const invalidate = useRefreshThreads();
  const [body, setBody] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      Services.messageThreads.postMessage(threadId, {
        body: body.trim(),
        is_internal_note: isInternalNote,
      }),
    onSuccess: () => {
      setBody("");
      setIsInternalNote(false);
      invalidate();
    },
  });

  const canSend = !isClosed && body.trim().length > 0 && !send.isPending;

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (canSend) send.mutate();
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-3">
      {send.isError && (
        <Alert variant="destructive">{resolveErrorMessage(send.error, tErrors, t("failed"))}</Alert>
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
      <div className="flex items-center justify-between gap-3">
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
        <Button
          type="submit"
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
