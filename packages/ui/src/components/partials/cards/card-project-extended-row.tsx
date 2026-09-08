"use client";

import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AvatarGroup } from "../common/avatar-group";
import { DropdownMenu1 } from "../dropdown-menu/dropdown-menu-1";
import { IProjectExtendedItem, IProjectExtendedProps } from "./card-project-extended";

const CardProjectExtendedRow = ({
  status,
  logo,
  title,
  description,
  team,
  statistics,
  url,
}: IProjectExtendedProps) => {
  const renderItem = (statistic: IProjectExtendedItem, index: number) => {
    return (
      <div
        key={index}
        className="max-w-auto grid min-w-24 shrink-0 grid-cols-1 content-between gap-1.5 rounded-md border border-dashed border-input px-2.5 py-2"
      >
        <span className="text-mono text-sm leading-none font-semibold">{statistic.total}</span>
        <span className="text-xs font-medium text-secondary-foreground">
          {statistic.description}
        </span>
      </div>
    );
  };

  return (
    <Card className="p-7.5">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-3.5">
          <div className="flex min-w-12 items-center justify-center">
            <img
              src={toAbsoluteUrl(`/media/brand-logos/${logo}`)}
              className="min-w-12 shrink-0"
              alt="image"
            />
          </div>
          <div className="flex flex-col">
            <Link href={url} className="text-mono text-lg font-medium hover:text-primary">
              {title}
            </Link>
            <div className="text-sm text-secondary-foreground">{description}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5 lg:gap-12">
          <div className="flex flex-wrap items-center gap-5 lg:gap-14">
            <div className="flex flex-wrap items-center gap-2 lg:justify-center lg:gap-5">
              {statistics.map((statistic, index) => {
                return renderItem(statistic, index);
              })}
            </div>
            <div className="w-[125px] shrink-0">
              <Badge size="lg" variant={status.variant} appearance="light">
                {status.label}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-5 lg:gap-14">
            <div className="grid min-w-24 justify-end">
              <AvatarGroup group={team.group} size={team.size} />
            </div>
            <DropdownMenu1
              trigger={
                <Button variant="ghost" mode="icon">
                  <EllipsisVertical />
                </Button>
              }
            />
          </div>
        </div>
      </div>
    </Card>
  );
};

export { CardProjectExtendedRow };
