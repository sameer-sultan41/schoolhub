import { Fragment } from "react";

import { Card, CardContent } from "@schoolhub/ui";

import { toAbsoluteUrl } from "@/app/(app)/_metronic/helpers";

// Ported verbatim from the vendor Metronic Next.js template's
// app/(protected)/components/demo1/light-sidebar/components/channel-stats.tsx.
interface ChannelStatsItem {
  logo: string;
  logoDark?: string;
  info: string;
  desc: string;
}

export function ChannelStats() {
  const items: ChannelStatsItem[] = [
    { logo: "linkedin-2.svg", info: "9.3k", desc: "Amazing mates" },
    { logo: "youtube-2.svg", info: "24k", desc: "Lessons Views" },
    { logo: "instagram-03.svg", info: "608", desc: "New subscribers" },
    { logo: "tiktok.svg", logoDark: "tiktok-dark.svg", info: "2.5k", desc: "Stream audience" },
  ];

  return (
    <Fragment>
      <style>
        {`
          .channel-stats-bg {
            background-image: url('${toAbsoluteUrl("/media/images/2600x1600/bg-3.png")}');
          }
          .dark .channel-stats-bg {
            background-image: url('${toAbsoluteUrl("/media/images/2600x1600/bg-3-dark.png")}');
          }
        `}
      </style>
      {items.map((item, index) => (
        <Card key={index}>
          <CardContent className="channel-stats-bg flex h-full flex-col justify-between gap-6 bg-cover bg-[right_top_-1.7rem] bg-no-repeat p-0 rtl:bg-[left_top_-1.7rem]">
            {item.logoDark ? (
              <>
                <img
                  src={toAbsoluteUrl(`/media/brand-logos/${item.logo}`)}
                  className="ms-5 mt-4 w-7 dark:hidden"
                  alt="image"
                />
                <img
                  src={toAbsoluteUrl(`/media/brand-logos/${item.logoDark}`)}
                  className="light:hidden ms-5 mt-4 w-7"
                  alt="image"
                />
              </>
            ) : (
              <img
                src={toAbsoluteUrl(`/media/brand-logos/${item.logo}`)}
                className="ms-5 mt-4 w-7"
                alt="image"
              />
            )}
            <div className="flex flex-col gap-1 px-5 pb-4">
              <span className="text-mono text-3xl font-semibold">{item.info}</span>
              <span className="text-sm font-normal text-muted-foreground">{item.desc}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </Fragment>
  );
}
