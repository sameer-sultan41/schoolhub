"use client";

import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu2 } from "../dropdown-menu/dropdown-menu-2";

interface ICampaignItem {
  total: string;
  description: string;
}
type ICampaignItems = Array<ICampaignItem>;

interface ICampaignProps {
  logo: string;
  logoSize?: string;
  logoDark?: string;
  title: string;
  description: string;
  status: {
    variant?:
      "primary" | "destructive" | "secondary" | "info" | "success" | "warning" | null | undefined;
    label: string;
  };
  statistics: ICampaignItem[];
  progress?: {
    variant: string;
    value: number;
  };
  url: string;
}

const CardCampaign = ({
  logo,
  logoSize,
  logoDark,
  title,
  description,
  status,
  statistics,
  progress,
  url,
}: ICampaignProps) => {
  const renderItem = (statistic: ICampaignItem, index: number) => {
    return (
      <div
        key={index}
        className="flex flex-col gap-1.5 rounded-md border border-dashed border-input px-2.5 py-2"
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
          <DropdownMenu2
            trigger={
              <Button variant="ghost" mode="icon">
                <EllipsisVertical />
              </Button>
            }
          />
        </div>
        <div className="mb-2 flex h-[50px] items-center justify-center">
          {logoDark ? (
            <>
              <img
                src={toAbsoluteUrl(`/media/brand-logos/${logo}`)}
                className={`dark:hidden size-[${logoSize}] shrink-0`}
                alt="image"
              />
              <img
                src={toAbsoluteUrl(`/media/brand-logos/${logoDark}`)}
                className={`light:hidden size-[${logoSize}] shrink-0`}
                alt="image"
              />
            </>
          ) : (
            <img
              src={toAbsoluteUrl(`/media/brand-logos/${logo}`)}
              className={`size-[${logoSize}] shrink-0`}
              alt="image"
            />
          )}
        </div>
        <div className="mb-7 text-center">
          <Link href={url} className="text-mono text-lg font-medium hover:text-primary">
            {title}
          </Link>
          <div className="text-sm text-secondary-foreground">{description}</div>
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

export { CardCampaign, type ICampaignItem, type ICampaignItems, type ICampaignProps };
