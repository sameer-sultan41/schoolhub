"use client";

import type { ReactNode } from "react";
import { MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@schoolhub/ui";

import { useUrlParams } from "@/hooks/use-url-params";
import { isUuid } from "@/lib/helpers";
import {
  STATUS_PARAM,
  THREAD_PARAM,
} from "@/services/modules/message-threads/message-threads-constant";
import type { MessageThreadStatus } from "@/services/modules/message-threads/message-threads-type";

import { ThreadList } from "./thread-list";
import type { ThreadSource } from "./thread-source";
import { ThreadView } from "./thread-view";

function toStatus(value: string | null): MessageThreadStatus | "" {
  return value === "open" || value === "closed" ? value : "";
}

export interface ThreadPanesProps {
  source: ThreadSource;
  readOnly: boolean;
  /** Above the panes: the inbox's New conversation button, oversight's audit banner. */
  header?: ReactNode;
  /** `false` hides close and reopen (the parent portal); the default keeps them. */
  canTransition?: boolean;
}

/**
 * The two panes the inbox and oversight share: the conversations on the left, the open one on
 * the right (below it on a narrow screen). The open thread and the status filter live in the
 * URL (`?thread=`, `?status=`), so a reload or a shared link keeps them.
 */
export function ThreadPanes({ source, readOnly, header, canTransition }: ThreadPanesProps) {
  const t = useTranslations("communication.messages");
  const { searchParams, setParams } = useUrlParams();
  const rawThread = searchParams.get(THREAD_PARAM);
  const threadId = rawThread !== null && isUuid(rawThread) ? rawThread : null;
  const status = toStatus(searchParams.get(STATUS_PARAM));

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className={threadId ? "hidden lg:block" : undefined}>
          <ThreadList
            source={source}
            selectedId={threadId}
            onSelect={(id) => {
              setParams({ [THREAD_PARAM]: id });
            }}
            status={status}
            onStatusChange={(next) => {
              setParams({ [STATUS_PARAM]: next || null, [THREAD_PARAM]: null });
            }}
          />
        </div>
        <div className={threadId ? undefined : "hidden lg:block"}>
          {threadId ? (
            <div className="flex flex-col gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="w-fit lg:hidden"
                onClick={() => {
                  setParams({ [THREAD_PARAM]: null });
                }}
              >
                {t("thread.back")}
              </Button>
              <ThreadView
                key={threadId}
                source={source}
                threadId={threadId}
                readOnly={readOnly}
                canTransition={canTransition}
              />
            </div>
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title={t("thread.selectTitle")}
              description={t("thread.selectDescription")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
