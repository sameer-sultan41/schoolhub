"use client";

import { Button } from "@schoolhub/ui";

import { toAbsoluteUrl } from "@/app/(app)/_metronic/helpers";

// Ported verbatim from packages/ui's partials/dialogs/search/search-empty.tsx.
export function SearchEmpty() {
  return (
    <div className="flex flex-col gap-5 py-9 text-center">
      <div className="flex justify-center">
        <img
          src={toAbsoluteUrl("/media/illustrations/33.svg")}
          className="max-h-[113px] dark:hidden"
          alt="image"
        />
        <img
          src={toAbsoluteUrl("/media/illustrations/33-dark.svg")}
          className="light:hidden max-h-[113px]"
          alt="image"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-mono text-center text-base font-semibold">Looking for something..</h3>
        <span className="text-center text-sm font-medium text-secondary-foreground">
          Initiate your digital experience with <br />
          our intuitive dashboard
        </span>
      </div>
      <div className="flex justify-center">
        <Button variant="outline">View Projects</Button>
      </div>
    </div>
  );
}
