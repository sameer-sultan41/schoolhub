"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { hasPermission } from "@/lib/permissions";

import { NewThreadDialog } from "./new-thread-dialog";
import { INBOX_SOURCE } from "./thread-source";
import { THREAD_PARAM, ThreadPanes } from "./thread-panes";

/** The Messages inbox: the caller's conversations and the open one, and Start a conversation. */
export function MessagesScreen() {
  const t = useTranslations("communication.messages");
  const { data: user } = useCurrentUser();
  const { setParams } = useUrlParams();
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const canCreate = hasPermission(user, "communication.thread.create");

  return (
    <>
      <ThreadPanes
        source={INBOX_SOURCE}
        readOnly={false}
        header={
          canCreate && (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setNewThreadOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("newThread.open")}
              </Button>
            </div>
          )
        }
      />
      {newThreadOpen && (
        <NewThreadDialog
          open
          onOpenChange={setNewThreadOpen}
          onCreated={(threadId) => {
            setParams({ [THREAD_PARAM]: threadId });
          }}
        />
      )}
    </>
  );
}
