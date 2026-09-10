import Link from "next/link";
import { MapPin, Users } from "lucide-react";

import { AvatarGroup, Button, Card, CardContent, CardFooter, toAbsoluteUrl } from "@schoolhub/ui";

// Ported verbatim from the vendor Metronic Next.js template's
// app/(protected)/components/demo1/light-sidebar/components/team-meeting.tsx.
export function TeamMeeting() {
  return (
    <Card className="h-full">
      <CardContent className="grow p-5 lg:p-7.5 lg:pt-6">
        <div className="mb-7.5 flex flex-wrap items-center justify-between gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-mono text-xl font-semibold">Team Meeting</span>
            <span className="text-sm font-semibold text-foreground">09:00 - 09:30</span>
          </div>
          <img src={toAbsoluteUrl("/media/brand-logos/zoom.svg")} className="size-7" alt="image" />
        </div>
        <p className="mb-8 text-sm leading-5.5 font-normal text-foreground">
          Team meeting to discuss strategies, outline <br />
          project milestones, define key goals, and <br />
          establish clear timelines.
        </p>
        <div className="flex gap-10 rounded-lg bg-accent/50 p-5">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-1.5 text-sm font-normal text-foreground">
              <MapPin size={16} className="text-base text-muted-foreground" />
              Location
            </div>
            <div className="pt-1.5 text-sm font-medium text-foreground">Amsterdam</div>
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-1.5 text-sm font-normal text-foreground">
              <Users size={16} className="text-base text-muted-foreground" />
              Team
            </div>
            <AvatarGroup
              size="size-[30px]"
              group={[
                { filename: "300-4.png" },
                { filename: "300-1.png" },
                { filename: "300-2.png" },
                { fallback: "+10", variant: "text-white border-success-soft bg-green-500" },
              ]}
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-center">
        <Button mode="link" underlined="dashed" asChild>
          <Link href="#">Join Meeting</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
