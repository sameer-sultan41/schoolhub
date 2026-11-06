"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { isCursorPagination } from "@schoolhub/types";
import { Badge, Button, cn, Skeleton } from "@schoolhub/ui";
import { toast } from "sonner";

import { LoadErrorCard } from "@/components/load-error-card";
import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { MESSAGES_PAGE_SIZE } from "@/services/modules/message-threads/message-threads-constant";
import type { MessageRecord } from "@/services/modules/message-threads/message-threads-type";

import type { ThreadSource } from "./thread-source";

/** One attachment of a message, as a download chip: a fresh signed URL is fetched per click. */
function AttachmentChip({
  source,
  threadId,
  fileId,
  position,
}: {
  source: ThreadSource;
  threadId: string;
  fileId: string;
  position: number;
}) {
  const t = useTranslations("communication.messages.message");
  const tErrors = useTranslations("errors");

  const download = useMutation({
    mutationFn: () => source.downloadAttachment(threadId, fileId),
    onSuccess: ({ download_url }) => {
      downloadFile(download_url);
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("attachmentFailed")));
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={download.isPending}
      onClick={() => {
        download.mutate();
      }}
    >
      <Paperclip aria-hidden="true" />
      {t("attachment", { number: position })}
    </Button>
  );
}

function MessageBubble({
  message,
  source,
  isOwn,
}: {
  message: MessageRecord;
  source: ThreadSource;
  isOwn: boolean;
}) {
  const t = useTranslations("communication.messages.message");

  return (
    <li className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1.5 rounded-lg px-3 py-2 text-sm",
          isOwn ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          message.is_internal_note && "border border-dashed border-border",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span>{t(isOwn ? "you" : "participant")}</span>
          {message.is_internal_note && (
            <Badge size="sm" variant="warning" appearance="light">
              {t("internalNote")}
            </Badge>
          )}
          <span className="font-normal opacity-80">
            {format(new Date(message.sent_at), "PP p")}
          </span>
        </div>
        <p className="break-words whitespace-pre-wrap">{message.body}</p>
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.attachments.map((fileId, index) => (
              <AttachmentChip
                key={fileId}
                source={source}
                threadId={message.thread_id}
                fileId={fileId}
                position={index + 1}
              />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export interface MessageListProps {
  source: ThreadSource;
  threadId: string;
  currentUserId: string | undefined;
}

/**
 * A conversation, oldest first. The API pages newest first, so the pages are flattened and
 * reversed, and "Load earlier" reads the next (older) page.
 */
export function MessageList({ source, threadId, currentUserId }: MessageListProps) {
  const t = useTranslations("communication.messages.message");
  const tErrors = useTranslations("errors");
  const bottomRef = useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey: queryKeys.list(source.module, "messages", { threadId }),
    queryFn: ({ pageParam }) =>
      source.listMessages(threadId, { cursor: pageParam, pageSize: MESSAGES_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination && isCursorPagination(lastPage.pagination)
        ? (lastPage.pagination.next_cursor ?? undefined)
        : undefined,
  });

  const messages = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items).reverse(),
    [query.data],
  );
  const newestId = messages[messages.length - 1]?.id;

  // A new message (or the first load) scrolls to the bottom; loading earlier ones does not.
  useEffect(() => {
    if (newestId) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [newestId]);

  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  if (query.isError && !query.data) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          isLoading={query.isFetchingNextPage}
          loadingLabel={t("loadingEarlier")}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t("loadEarlier")}
        </Button>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              source={source}
              isOwn={currentUserId !== undefined && message.sender_id === currentUserId}
            />
          ))}
        </ul>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
