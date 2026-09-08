"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AvatarGroup } from "../common/avatar-group";

interface INowPlayingItem {
  number: string;
  description: string;
}
type INowPlayingItems = Array<INowPlayingItem>;

interface INowPlayingProps {
  image: string;
  logo: string;
  title: string;
  date: string;
  statistics: INowPlayingItem[];
  label: number;
  team: {
    group: Array<{ filename: string }>;
    more?: {
      number: number;
      variant: string;
    };
  };
}

const CardNowPlaying = ({
  image,
  logo,
  title,
  date,
  statistics,
  team,
  label,
}: INowPlayingProps) => {
  const renderItem = (statistic: INowPlayingItem, index: number) => {
    return (
      <div key={index} className="grid grid-cols-1 gap-1.5 text-center">
        <span className="text-mono text-sm leading-none font-semibold">{statistic.number}%</span>
        <span className="text-xs font-medium text-secondary-foreground">
          {statistic.description}
        </span>
      </div>
    );
  };

  return (
    <Card className="mb-5 w-[280px] shadow-none">
      <img
        src={toAbsoluteUrl(`/media/images/600x600/${image}`)}
        className="max-w-[280px] shrink-0 rounded-t-xl"
        alt="image"
      />
      <div className="card-border card-rounded-b mb-4.5 grid gap-6 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <img
            src={toAbsoluteUrl(`/media/images/600x600/${logo}`)}
            className="size-10 rounded-full"
            alt="image"
          />
          <div className="grid grid-cols-1 gap-0.5">
            <Link
              href="#"
              className="text-mono hover:text-primary-active mb-px text-base font-semibold"
            >
              {title}
            </Link>
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {date}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {statistics.map((statistic, index) => {
            return renderItem(statistic, index);
          })}
        </div>
        <div className="flex place-content-between items-center gap-2">
          <AvatarGroup group={team.group} more={team.more} />
          <Badge size="sm" variant="warning" appearance="light">
            Rank {label}
          </Badge>
        </div>
      </div>
    </Card>
  );
};

export { CardNowPlaying, type INowPlayingItem, type INowPlayingItems, type INowPlayingProps };
