import { Fragment } from "react";
import Link from "next/link";

import { Button, Card, CardContent, CardFooter, cn } from "@schoolhub/ui";

import { toAbsoluteUrl } from "../helpers";
import { AvatarGroup } from "../partials/common/avatar-group";

// Ported verbatim from the vendor Metronic Next.js template's
// app/(protected)/components/demo1/light-sidebar/components/entry-callout.tsx.
export function EntryCallout({ className }: { className?: string }) {
  return (
    <Fragment>
      <style>
        {`
          .entry-callout-bg {
            background-image: url('${toAbsoluteUrl("/media/images/2600x1600/2.png")}');
          }
          .dark .entry-callout-bg {
            background-image: url('${toAbsoluteUrl("/media/images/2600x1600/2-dark.png")}');
          }
        `}
      </style>
      <Card className={cn("h-full", className)}>
        <CardContent className="entry-callout-bg bg-[length:80%] [background-position:175%_25%] bg-no-repeat p-10 rtl:[background-position:-70%_25%]">
          <div className="flex flex-col justify-center gap-4">
            <AvatarGroup
              size="size-10"
              group={[
                { filename: "300-4.png" },
                { filename: "300-1.png" },
                { filename: "300-2.png" },
                { fallback: "S", variant: "text-white text-xs ring-background bg-green-500" },
              ]}
            />
            <h2 className="text-mono text-xl font-semibold">
              Connect Today &amp; Join <br />
              the{" "}
              <Button mode="link" asChild className="text-xl font-semibold">
                <Link href="#">KeenThemes Network</Link>
              </Button>
            </h2>
            <p className="text-sm leading-5.5 font-normal text-secondary-foreground">
              Enhance your projects with premium themes and <br />
              templates. Join the KeenThemes community today <br />
              for top-quality designs and resources.
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-center">
          <Button mode="link" underlined="dashed" asChild>
            <Link href="#">Get Started</Link>
          </Button>
        </CardFooter>
      </Card>
    </Fragment>
  );
}
