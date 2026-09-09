"use client";

import { Fragment, useState } from "react";
import { addDays, format } from "date-fns";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button, Calendar, Popover, PopoverContent, PopoverTrigger } from "@schoolhub/ui";

import { Container } from "@/app/(app)/_metronic/partials/common/container";
import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/_metronic/toolbar";
import { ChannelStats } from "@/app/(app)/_metronic/dashboard/channel-stats";
import { EarningsChart } from "@/app/(app)/_metronic/dashboard/earnings-chart";
import { EntryCallout } from "@/app/(app)/_metronic/dashboard/entry-callout";
import { Highlights } from "@/app/(app)/_metronic/dashboard/highlights";
import { TeamMeeting } from "@/app/(app)/_metronic/dashboard/team-meeting";
import { Teams } from "@/app/(app)/_metronic/dashboard/teams";

// Combines the vendor Metronic Next.js template's own
// demo1-light-sidebar-page.tsx (toolbar + date-range picker) and
// demo1-light-sidebar-content.tsx (the 3-row widget grid) — Metronic's real,
// official Demo1 dashboard landing page, content unchanged.
export function DashboardPageContent() {
  const [isOpen, setIsOpen] = useState(false);
  const [date, setDate] = useState<DateRange | undefined>({
    from: new Date(2025, 0, 20),
    to: addDays(new Date(2025, 0, 20), 20),
  });
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(date);

  const handleDateRangeApply = () => {
    setDate(tempDateRange);
    setIsOpen(false);
  };

  const handleDateRangeReset = () => {
    setTempDateRange(undefined);
  };

  return (
    <Fragment>
      <Container>
        <Toolbar>
          <ToolbarHeading title="Dashboard" description="Central Hub for Personal Customization" />
          <ToolbarActions>
            <Popover open={isOpen} onOpenChange={setIsOpen}>
              <PopoverTrigger asChild>
                <Button id="date" variant="outline">
                  <CalendarDays size={16} className="me-0.5" />
                  {date?.from ? (
                    date.to ? (
                      <>
                        {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(date.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  defaultMonth={tempDateRange?.from || new Date()}
                  selected={tempDateRange}
                  onSelect={setTempDateRange}
                  numberOfMonths={2}
                />
                <div className="flex items-center justify-end gap-1.5 border-t border-border p-3">
                  <Button variant="outline" onClick={handleDateRangeReset}>
                    Reset
                  </Button>
                  <Button onClick={handleDateRangeApply}>Apply</Button>
                </div>
              </PopoverContent>
            </Popover>
          </ToolbarActions>
        </Toolbar>
      </Container>
      <Container>
        <div className="grid gap-5 lg:gap-7.5">
          <div className="grid items-stretch gap-y-5 lg:grid-cols-3 lg:gap-7.5">
            <div className="lg:col-span-1">
              <div className="grid h-full grid-cols-2 items-stretch gap-5 lg:gap-7.5">
                <ChannelStats />
              </div>
            </div>
            <div className="lg:col-span-2">
              <EntryCallout className="h-full" />
            </div>
          </div>
          <div className="grid items-stretch gap-5 lg:grid-cols-3 lg:gap-7.5">
            <div className="lg:col-span-1">
              <Highlights limit={3} />
            </div>
            <div className="lg:col-span-2">
              <EarningsChart />
            </div>
          </div>
          <div className="grid items-stretch gap-5 lg:grid-cols-3 lg:gap-7.5">
            <div className="lg:col-span-1">
              <TeamMeeting />
            </div>
            <div className="lg:col-span-2">
              <Teams />
            </div>
          </div>
        </div>
      </Container>
    </Fragment>
  );
}
