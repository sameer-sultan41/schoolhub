"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Input, Label, Skeleton } from "@schoolhub/ui";

import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import type { BroadcastRequest } from "@/services/modules/broadcasts/broadcasts-type";

import { broadcastSignature, useBroadcastKey } from "./use-broadcast-key";

export interface ConfirmStepProps {
  request: BroadcastRequest;
  /** Called with the job to watch once the server accepted the send. */
  onQueued: (jobId: string) => void;
}

/** The recipient count a 409 `audience_changed` reports in `error.meta`, if it is a number. */
function changedCount(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== "audience_changed") return null;
  const count = error.meta.recipient_count;
  return typeof count === "number" ? count : null;
}

/**
 * Step 3: previews who would receive the broadcast, and sends it once the sender has typed
 * that exact count. Mounted only while the step shows, so each visit previews afresh.
 */
export function ConfirmStep({ request, onQueued }: ConfirmStepProps) {
  const t = useTranslations("communication.broadcast.confirm");
  const tErrors = useTranslations("errors");
  const [typed, setTyped] = useState("");
  const [changedTo, setChangedTo] = useState<number | null>(null);
  const { keyFor, forget } = useBroadcastKey();

  const preview = useQuery({
    queryKey: queryKeys.list("broadcasts", "preview", request),
    queryFn: () => Services.broadcasts.preview(request),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = preview.data;

  const send = useMutation({
    mutationFn: (confirmed: { count: number; digest: string }) =>
      Services.broadcasts.send(
        {
          ...request,
          confirm_recipient_count: confirmed.count,
          audience_digest: confirmed.digest,
        },
        keyFor(broadcastSignature(request, confirmed.count, confirmed.digest)),
      ),
    onSuccess: (job) => {
      onQueued(job.job_id);
    },
    onError: (error) => {
      const count = changedCount(error);
      if (count === null) {
        // A key the server has bound to another body is spent: the next try needs a new one.
        if (error instanceof ApiError && error.code === "idempotency_key_reused") forget();
        return;
      }
      setChangedTo(count);
      setTyped("");
      void preview.refetch();
    },
  });

  if (preview.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (!data) {
    return (
      <Alert variant="destructive">
        {resolveErrorMessage(preview.error, tErrors, t("previewFailed"))}
      </Alert>
    );
  }

  const count = data.recipient_count;
  const matches = typed.trim() === String(count);
  const showSendError = send.isError && changedCount(send.error) === null;

  return (
    <div className="space-y-5">
      {changedTo !== null && (
        <Alert variant="warning">{t("audienceChanged", { count: changedTo })}</Alert>
      )}
      <p className="text-lg font-semibold text-foreground">{t("recipients", { count })}</p>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t("channels")}</p>
        <div className="flex flex-wrap gap-2">
          {data.channels.map((channel) => (
            <Badge key={channel} variant="success" appearance="light">
              {channel}
            </Badge>
          ))}
          {data.unavailable_channels.map((channel) => (
            <Badge key={channel} variant="secondary" appearance="light" className="opacity-60">
              {t("notDelivered", { channel })}
            </Badge>
          ))}
        </div>
      </div>

      {count === 0 ? (
        <Alert variant="warning">{t("nobody")}</Alert>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="broadcast-confirm-count">{t("typeCount", { count })}</Label>
          <Input
            id="broadcast-confirm-count"
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            disabled={preview.isFetching}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
      )}

      {showSendError && (
        <Alert variant="destructive">
          {resolveErrorMessage(send.error, tErrors, t("sendFailed"))}
        </Alert>
      )}

      <Button
        variant="destructive"
        disabled={count === 0 || !matches || send.isPending || preview.isFetching}
        onClick={() => {
          send.mutate({ count, digest: data.audience_digest });
        }}
      >
        {send.isPending ? t("sending") : t("send")}
      </Button>
    </div>
  );
}
