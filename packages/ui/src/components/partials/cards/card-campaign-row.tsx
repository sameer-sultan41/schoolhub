"use client";

import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu3 } from "../dropdown-menu/dropdown-menu-3";
import { ICampaignItem, ICampaignProps } from "./card-campaign";

const CardCampaignRow = ({
  logo,
  logoSize,
  logoDark,
  title,
  description,
  status,
  statistics,
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
    <Card className="p-5 lg:p-7.5">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-3.5">
          <div className="flex w-[50px] items-center justify-center">
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
          <div>
            <Link href={url} className="text-mono text-lg font-medium hover:text-primary">
              {title}
            </Link>
            <div className="flex items-center text-sm text-secondary-foreground">{description}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-5 lg:gap-12">
          <div className="flex flex-wrap items-center gap-2 lg:gap-5">
            {statistics.map((statistic, index) => {
              return renderItem(statistic, index);
            })}
          </div>
          <div className="flex w-20 justify-center">
            <Badge size="lg" variant={status.variant} appearance="light">
              {status.label}
            </Badge>
          </div>
          <DropdownMenu3
            trigger={
              <Button variant="ghost" mode="icon">
                <EllipsisVertical />
              </Button>
            }
          />
        </div>
      </div>
    </Card>
  );
};

export { CardCampaignRow };
