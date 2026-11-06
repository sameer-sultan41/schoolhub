"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { ChildGate } from "@/features/portal/shell/child-gate";
import { LeaveList } from "./leave-list";
import { NewLeaveDialog } from "./new-leave-dialog";

/** One child's leave: the requests so far, and a new one. */
export function PortalLeave() {
  return <ChildGate>{(child) => <ChildLeave studentId={child.student.id} />}</ChildGate>;
}

function ChildLeave({ studentId }: { studentId: string }) {
  const t = useTranslations("portal.leave");
  const { data: user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  // The server enforces the key; hiding the button is only to spare a certain refusal.
  const canCreate = hasPermission(user, "attendance.leave-request.create");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
        {canCreate && (
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t("new.open")}
          </Button>
        )}
      </div>
      <LeaveList studentId={studentId} />
      {open && <NewLeaveDialog open onOpenChange={setOpen} studentId={studentId} />}
    </section>
  );
}
