"use client";

import { Button } from "@/components/ui/button";

const MegaMenuFooter = () => {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-4 py-4 lg:justify-between lg:rounded-t-none lg:border-0 lg:border-t lg:border-t-border lg:px-7.5 lg:py-5">
      <div className="flex flex-col gap-1.5">
        <div className="text-mono text-base leading-none font-semibold">Read to Get Started ?</div>
        <div className="fomt-medium text-sm text-secondary-foreground">
          Take your docs to the next level of Metronic
        </div>
      </div>
      <Button variant="mono" asChild>
        <a href="https://keenthemes.com/metronic" target="_blank" rel="noopener noreferrer">
          Read Documentation
        </a>
      </Button>
    </div>
  );
};

export { MegaMenuFooter };
