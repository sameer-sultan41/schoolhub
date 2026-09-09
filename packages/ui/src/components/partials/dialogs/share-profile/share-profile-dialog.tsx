"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShareProfileSettings,
  ShareProfileUsers,
  ShareProfileViaEmail,
  ShareProfileViaLink,
} from "./";

export function ShareProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: () => void;
}) {
  const scrollableHeight = 300;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] space-y-0 p-0">
        <DialogHeader className="m-0 p-5">
          <DialogTitle>Share Profile</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 px-0 pt-1 pb-5">
          <ShareProfileViaLink />

          <div className="border-b border-b-border"></div>

          <ShareProfileViaEmail />

          <div className="border-b border-b-border"></div>

          <div className="scrollable-y-auto" style={{ maxHeight: `${scrollableHeight}px` }}>
            <ShareProfileUsers />
          </div>

          <div className="border-b border-b-border"></div>

          <ShareProfileSettings />
        </div>
      </DialogContent>
    </Dialog>
  );
}
