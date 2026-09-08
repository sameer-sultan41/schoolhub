"use client";

import Link from "next/link";
import { SquareDashedBottomCode } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TimelineItem } from "./timeline-item";

const ActivitiesPhotographyWorkshop = () => {
  return (
    <TimelineItem icon={SquareDashedBottomCode} line={true}>
      <div className="flex flex-col pb-2.5">
        <span className="text-sm text-foreground">
          Jenny attended a Nature Photography Immersion workshop
        </span>
        <span className="text-xs text-secondary-foreground">3 days ago, 11:45 AM</span>
      </div>
      <Card className="shadow-none">
        <CardContent>
          <div className="grid gap-4">
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <div className="flex shrink-0 items-center gap-5">
                <div className="max-h-20 rounded-lg border border-orange-200">
                  <div className="flex items-center justify-center rounded-t-lg border-b border-b-orange-200 bg-orange-50 dark:border-orange-950 dark:bg-orange-950/30">
                    <span className="p-2 text-sm font-medium text-orange-400">Apr</span>
                  </div>
                  <div className="flex size-12 items-center justify-center">
                    <span className="text-xl font-medium tracking-tight text-foreground">02</span>
                  </div>
                </div>
                <img
                  src={toAbsoluteUrl("/media/images/600x400/8.jpg")}
                  className="max-h-20 max-w-full rounded-lg"
                  alt="image"
                />
              </div>
              <div className="flex flex-col items-start gap-2">
                <Button
                  mode="link"
                  asChild
                  className="hover:text-primary-active mb-px text-xs leading-[14px] text-orange-400"
                >
                  <Link href="#">Nature Photography Immersion</Link>
                </Button>
                <Button
                  mode="link"
                  asChild
                  className="text-mono text-base leading-4 font-medium hover:text-primary"
                >
                  <Link href="#">Nature Photography Immersion</Link>
                </Button>
                <p className="text-xs leading-[22px] text-foreground">
                  Enhance your nature photography skills in a hands-on workshop guided by
                  experienced photographers.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </TimelineItem>
  );
};

export { ActivitiesPhotographyWorkshop };
