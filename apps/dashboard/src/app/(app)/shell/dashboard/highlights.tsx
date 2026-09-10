import {
  RiBankLine,
  RiFacebookCircleLine,
  RiGoogleLine,
  RiInstagramLine,
  RiStore2Line,
  type RemixiconComponentType,
} from "@remixicon/react";
import { ArrowDown, ArrowUp, EllipsisVertical, type LucideIcon } from "lucide-react";

import {
  Badge,
  BadgeDot,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu4,
} from "@schoolhub/ui";

// Ported from the vendor Metronic Next.js template's app/(protected)/components/
// demo1/light-sidebar/components/highlights.tsx — the vendor's own social-channel
// brand icons come from @remixicon/react (a new dependency), not lucide, since
// lucide has no brand marks for Facebook/Instagram/Google/etc.
interface HighlightsRow {
  icon: LucideIcon | RemixiconComponentType;
  text: string;
  total: number;
  stats: number;
  increase: boolean;
}

interface HighlightsItem {
  badgeColor: string;
  label: string;
}

export function Highlights({ limit }: { limit?: number }) {
  const rows: HighlightsRow[] = [
    { icon: RiStore2Line, text: "Online Store", total: 172, stats: 3.9, increase: true },
    { icon: RiFacebookCircleLine, text: "Facebook", total: 85, stats: 0.7, increase: false },
    { icon: RiInstagramLine, text: "Instagram", total: 36, stats: 8.2, increase: true },
    { icon: RiGoogleLine, text: "Google", total: 26, stats: 8.2, increase: true },
    { icon: RiBankLine, text: "Retail", total: 7, stats: 0.7, increase: false },
  ];

  const items: HighlightsItem[] = [
    { badgeColor: "bg-green-500", label: "Metronic" },
    { badgeColor: "bg-destructive", label: "Bundle" },
    { badgeColor: "bg-violet-500", label: "MetronicNest" },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Highlights</CardTitle>
        <DropdownMenu4
          trigger={
            <Button variant="ghost" mode="icon">
              <EllipsisVertical />
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-5 lg:p-7.5 lg:pt-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-normal text-secondary-foreground">All time sales</span>
          <div className="flex items-center gap-2.5">
            <span className="text-mono text-3xl font-semibold">$295.7k</span>
            <Badge size="sm" variant="success" appearance="light">
              +2.7%
            </Badge>
          </div>
        </div>
        <div className="mb-1.5 flex items-center gap-1">
          <div className="h-2 w-full max-w-[60%] rounded-xs bg-green-500"></div>
          <div className="h-2 w-full max-w-[25%] rounded-xs bg-destructive"></div>
          <div className="h-2 w-full max-w-[15%] rounded-xs bg-violet-500"></div>
        </div>
        <div className="mb-1 flex flex-wrap items-center gap-4">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <BadgeDot className={item.badgeColor} />
              <span className="text-sm font-normal text-foreground">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="border-b border-input"></div>
        <div className="grid gap-3">
          {rows.slice(0, limit).map((row, index) => (
            <div key={index} className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <row.icon className="size-4.5 text-muted-foreground" />
                <span className="text-mono text-sm font-normal">{row.text}</span>
              </div>
              <div className="flex items-center gap-6 text-sm font-medium text-foreground">
                <span className="lg:text-right">${row.total}k</span>
                <span className="flex items-center justify-end gap-1">
                  {row.increase ? (
                    <ArrowUp className="size-4 text-green-500" />
                  ) : (
                    <ArrowDown className="size-4 text-destructive" />
                  )}
                  {row.stats}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
