"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { NewThreadDialog } from "@/features/communication/messages/new-thread-dialog";
import { ThreadPanes } from "@/features/communication/messages/thread-panes";
import { INBOX_SOURCE } from "@/features/communication/messages/thread-source";
import { usePortalSummary } from "@/features/portal/use-portal-summary";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { hasPermission } from "@/lib/permissions";
import { THREAD_PARAM } from "@/services/modules/message-threads/message-threads-constant";

/** `/portal/messages`: the staff Messages inbox in portal mode. The student picker lists only the
 * summary's children, and there is no recipient picker, close or reopen. */
export function PortalMessages() {
  const t = useTranslations("communication.messages");
  const { data: user } = useCurrentUser();
  const summary = usePortalSummary();
  const { setParams } = useUrlParams();
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const canCreate = hasPermission(user, "communication.thread.create");

  const students = useMemo(
    () =>
      (summary.data?.children ?? []).map(({ student }) => ({
        id: student.id,
        name: `${student.first_name} ${student.last_name}`,
      })),
    [summary.data],
  );

  return (
    <>
      <ThreadPanes
        source={INBOX_SOURCE}
        readOnly={false}
        canTransition={false}
        allowAttachments
        header={
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
            {canCreate && students.length > 0 && (
              <Button
                onClick={() => {
                  setNewThreadOpen(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("newThread.open")}
              </Button>
            )}
          </div>
        }
      />
      {newThreadOpen && (
        <NewThreadDialog
          open
          onOpenChange={setNewThreadOpen}
          students={students}
          allowAttachments
          onCreated={(threadId) => {
            setParams({ [THREAD_PARAM]: threadId });
          }}
        />
      )}
    </>
  );
}
