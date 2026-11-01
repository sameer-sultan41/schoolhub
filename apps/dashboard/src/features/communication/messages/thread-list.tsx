"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, Button, cn, EmptyState, Skeleton } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCursorList } from "@/hooks/use-cursor-list";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatLastUpdated } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { THREADS_PAGE_SIZE } from "@/services/modules/message-threads/message-threads-constant";
import type { MessageThreadStatus } from "@/services/modules/message-threads/message-threads-type";

import { ThreadStatusBadge } from "./thread-status-badge";
import type { ThreadRow, ThreadSource } from "./thread-source";

export interface ThreadListProps {
  source: ThreadSource;
  selectedId: string | null;
  onSelect: (threadId: string) => void;
  /** `""` for every status. */
  status: MessageThreadStatus | "";
  onStatusChange: (status: MessageThreadStatus | "") => void;
}

/** The conversations of a source, newest activity first, paged by cursor, filtered by status. */
export function ThreadList({
  source,
  selectedId,
  onSelect,
  status,
  onStatusChange,
}: ThreadListProps) {
  const t = useTranslations("communication.messages");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const { query, rows, stack, nextCursor, retry } = useCursorList<ThreadRow>({
    resetKey: status,
    queryKey: (cursor) => queryKeys.list(source.module, "threads", { status, cursor }),
    queryFn: (cursor) =>
      source.listThreads({
        status: status || undefined,
        cursor,
        pageSize: THREADS_PAGE_SIZE,
      }),
  });

  return (
    <section aria-label={t("list.label")} className="flex flex-col gap-3">
      <FilterSelect
        label={t("status.filter")}
        allLabel={t("status.all")}
        value={status}
        onChange={(value) => {
          onStatusChange(value === "open" || value === "closed" ? value : "");
        }}
        options={[
          { id: "open", name: t("status.open") },
          { id: "closed", name: t("status.closed") },
        ]}
      />
      {query.isPending && <Skeleton className="h-24 w-full" />}
      {query.isError && !query.data && (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("list.loadError"))}
          onRetry={retry}
        />
      )}
      {query.data && rows.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          title={t(status ? "list.noMatches" : "list.emptyTitle")}
          description={t(status ? "list.noMatchesDescription" : "list.emptyDescription")}
        />
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rows.map((thread) => (
            <li key={thread.id}>
              <Button
                variant="ghost"
                aria-current={thread.id === selectedId ? "true" : undefined}
                className={cn(
                  "h-auto w-full flex-col items-start gap-1 px-3 py-2 text-start whitespace-normal",
                  thread.id === selectedId && "bg-accent",
                )}
                onClick={() => {
                  onSelect(thread.id);
                }}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {thread.subject}
                  </span>
                  {(thread.unread_count ?? 0) > 0 && (
                    <Badge
                      size="sm"
                      variant="primary"
                      aria-label={t("list.unread", { count: thread.unread_count ?? 0 })}
                    >
                      {thread.unread_count}
                    </Badge>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
                  <ThreadStatusBadge status={thread.status} />
                  <span>{t(`type.${thread.thread_type}`)}</span>
                  <span>{formatLastUpdated(thread.last_message_at)}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(stack.hasPrevious || nextCursor) && (
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!stack.hasPrevious}
            onClick={stack.goPrevious}
          >
            {tCommon("previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor}
            onClick={() => {
              if (nextCursor) stack.goNext(nextCursor);
            }}
          >
            {tCommon("next")}
          </Button>
        </div>
      )}
    </section>
  );
}
