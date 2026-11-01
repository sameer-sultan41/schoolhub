"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquareOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, Button, EmptyState, Skeleton } from "@schoolhub/ui";

import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";

import { MessageList } from "./message-list";
import { ReplyComposer } from "./reply-composer";
import type { ThreadSource } from "./thread-source";
import { ThreadStatusBadge } from "./thread-status-badge";
import { useRefreshThreads } from "./use-refresh-threads";

export interface ThreadViewProps {
  source: ThreadSource;
  threadId: string;
  /** Oversight: no composer, no close or reopen, and the thread is never marked read. */
  readOnly: boolean;
}

/** One conversation: its header, the messages and, for a participant, the reply box. */
export function ThreadView({ source, threadId, readOnly }: ThreadViewProps) {
  const t = useTranslations("communication.messages");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const invalidate = useRefreshThreads();
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // `:mark-read` is keyed `communication.message.create` on the server, so a reader without it
  // would only get a 403: never call it for them.
  const canPost = !readOnly && hasPermission(user, "communication.message.create");
  const canClose = !readOnly && hasPermission(user, "communication.thread.close");

  const thread = useQuery({
    queryKey: queryKeys.detail(source.module, "threads", threadId),
    queryFn: () => source.fetchThread(threadId),
  });

  const { mutate: markRead } = useMutation({
    mutationFn: () => Services.messageThreads.markRead(threadId),
    onSuccess: invalidate,
  });
  const markedRef = useRef<string | null>(null);
  const canMarkRead = canPost && thread.isSuccess;
  useEffect(() => {
    if (!canMarkRead || markedRef.current === threadId) return;
    markedRef.current = threadId;
    markRead();
  }, [canMarkRead, threadId, markRead]);

  const transition = useMutation({
    mutationFn: (action: "close" | "reopen") =>
      action === "close"
        ? Services.messageThreads.closeThread(threadId)
        : Services.messageThreads.reopenThread(threadId),
    onMutate: () => {
      setTransitionError(null);
    },
    onSuccess: invalidate,
    onError: (error) => {
      setTransitionError(resolveErrorMessage(error, tErrors, t("thread.transitionFailed")));
    },
  });

  if (thread.isPending) return <Skeleton className="h-48 w-full" />;
  if (thread.isError) {
    if (thread.error instanceof ApiError && thread.error.isNotFound) {
      return (
        <EmptyState
          icon={MessageSquareOff}
          title={t("thread.notFoundTitle")}
          description={t("thread.notFoundDescription")}
        />
      );
    }
    return (
      <LoadErrorCard
        message={resolveErrorMessage(thread.error, tErrors, t("thread.loadError"))}
        onRetry={() => {
          void thread.refetch();
        }}
      />
    );
  }

  const { data } = thread;
  const isClosed = data.status === "closed";

  return (
    <article aria-label={data.subject} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">{data.subject}</h2>
          <ThreadStatusBadge status={data.status} />
        </div>
        {canClose && !isClosed && (
          <Button
            variant="outline"
            size="sm"
            isLoading={transition.isPending}
            loadingLabel={t("thread.closing")}
            onClick={() => {
              transition.mutate("close");
            }}
          >
            {t("thread.close")}
          </Button>
        )}
      </header>
      {transitionError && <Alert variant="destructive">{transitionError}</Alert>}
      <MessageList source={source} threadId={threadId} currentUserId={user?.id} />
      {isClosed && !readOnly && (
        <Alert variant="info" className="flex items-center justify-between gap-3">
          <span>{t("thread.closedNotice")}</span>
          {canClose && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              isLoading={transition.isPending}
              loadingLabel={t("thread.reopening")}
              onClick={() => {
                transition.mutate("reopen");
              }}
            >
              {t("thread.reopen")}
            </Button>
          )}
        </Alert>
      )}
      {canPost && <ReplyComposer threadId={threadId} isClosed={isClosed} />}
    </article>
  );
}
