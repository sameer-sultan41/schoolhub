"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function WelcomeMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader className="border-0">
          <DialogTitle></DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col items-center pt-10 pb-10">
          <div className="mb-10">
            <img
              src={toAbsoluteUrl("/media/illustrations/21.svg")}
              className="max-h-[140px] dark:hidden"
              alt="image"
            />
            <img
              src={toAbsoluteUrl("/media/illustrations/21-dark.svg")}
              className="light:hidden max-h-[140px]"
              alt="image"
            />
          </div>

          <h3 className="text-mono mb-3 text-center text-lg font-medium">Welcome to Metronic</h3>

          <div className="mb-7 text-center text-sm text-secondary-foreground">
            We're thrilled to have you on board and excited for <br />
            the journey ahead together.
          </div>

          <div className="mb-2 flex justify-center">
            <Link href="/" className="btn btn-primary flex justify-center">
              Show me around
            </Link>
          </div>

          <Link
            href="/"
            className="py-3 text-sm font-medium text-secondary-foreground hover:text-primary"
          >
            Skip the tour
          </Link>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
