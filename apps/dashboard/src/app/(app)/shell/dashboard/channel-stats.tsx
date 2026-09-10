"use client";

import { Building2, GraduationCap, IdCard, Users, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, Skeleton } from "@schoolhub/ui";

import { Services } from "@/services";

/**
 * Repurposed from the vendor Metronic template's channel-stats.tsx (originally four
 * social-media follower counts) into four real school headline counts — see
 * `services/modules/dashboard/dashboard-service.ts`'s `fetchDashboardOverview`.
 */
interface SnapshotItem {
  icon: LucideIcon;
  value: number | null;
  desc: string;
}

function formatValue(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

export function ChannelStats() {
  const { data, isPending } = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => Services.dashboard.fetchDashboardOverview(),
  });

  if (isPending || !data) {
    return (
      <>
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <CardContent className="flex h-full flex-col justify-between gap-6 p-5">
              <Skeleton className="size-7" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </>
    );
  }

  const items: SnapshotItem[] = [
    { icon: Users, value: data.students, desc: "Enrolled students" },
    { icon: IdCard, value: data.staff, desc: "Staff members" },
    { icon: GraduationCap, value: data.classes, desc: "Classes" },
    { icon: Building2, value: data.campuses, desc: "Campuses" },
  ];

  return (
    <>
      {items.map((item, index) => (
        <Card key={index}>
          <CardContent className="flex h-full flex-col justify-between gap-6 p-5">
            <item.icon className="size-7 text-muted-foreground" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="text-mono text-3xl font-semibold">{formatValue(item.value)}</span>
              <span className="text-sm font-normal text-muted-foreground">{item.desc}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
