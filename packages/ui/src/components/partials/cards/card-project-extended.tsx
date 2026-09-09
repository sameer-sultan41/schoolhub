"use client";

import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AvatarGroup } from "../common/avatar-group";
import { DropdownMenu5 } from "../dropdown-menu/dropdown-menu-5";

interface IProjectExtendedItem {
  total: string;
  description: string;
}
type IProjectExtendedItems = Array<IProjectExtendedItem>;

interface IProjectExtendedProps {
  status: {
    variant?:
      "primary" | "destructive" | "secondary" | "info" | "success" | "warning" | null | undefined;
    label: string;
  };
  logo: string;
  title: string;
  description: string;
  team: {
    size?: string;
    group: Array<{ filename?: string; variant?: string; fallback?: string }>;
  };
  statistics: IProjectExtendedItem[];
  progress?: {
    variant: string;
    value: number;
  };
  url: string;
}

const CardProjectExtended = ({
  status,
  logo,
  title,
  description,
  team,
  statistics,
  progress,
  url,
}: IProjectExtendedProps) => {
  const renderItem = (statistic: IProjectExtendedItem, index: number) => {
    return (
      <div
        key={index}
        className="max-w-auto grid min-w-24 shrink-0 grid-cols-1 content-between gap-1.5 rounded-md border border-dashed border-input px-2.5 py-2"
      >
        <span className="text-mono text-sm leading-none font-medium">{statistic.total}</span>
        <span className="text-xs text-secondary-foreground">{statistic.description}</span>
      </div>
    );
  };

  return (
    <Card className="grow justify-between overflow-hidden">
      <div className="mb-5 p-5">
        <div className="mb-5 flex items-center justify-between">
          <Badge size="lg" variant={status.variant} appearance="light">
            {status.label}
          </Badge>
          <DropdownMenu5
            trigger={
              <Button variant="ghost" mode="icon">
                <EllipsisVertical />
              </Button>
            }
          />
        </div>
        <div className="mb-2 flex justify-center">
          <img
            src={toAbsoluteUrl(`/media/brand-logos/${logo}`)}
            className="min-w-12 shrink-0"
            alt="image"
          />
        </div>
        <div className="mb-7 text-center">
          <Link href={url} className="text-mono text-lg font-medium hover:text-primary">
            {title}
          </Link>
          <div className="text-sm text-secondary-foreground">{description}</div>
        </div>
        <div className="mb-7.5 grid justify-center gap-1.5">
          <span className="text-center text-xs text-secondary-foreground uppercase">team</span>
          <AvatarGroup group={team.group} size={team.size} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 lg:gap-5">
          {statistics.map((statistic, index) => {
            return renderItem(statistic, index);
          })}
        </div>
      </div>
      <Progress value={progress?.value} indicatorClassName={progress?.variant} className="h-1" />
    </Card>
  );
};

export {
  CardProjectExtended,
  type IProjectExtendedItem,
  type IProjectExtendedItems,
  type IProjectExtendedProps,
};
