"use client";
"use client";

import Link from "next/link";
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ToolbarMenu() {
  const months = [
    { title: "January, 2024" },
    { title: "February, 2024" },
    { title: "March, 2024", active: true },
    { title: "April, 2024" },
    { title: "May, 2024" },
    { title: "June, 2024" },
    { title: "July, 2024" },
    { title: "August, 2024" },
    { title: "September, 2024" },
    { title: "October, 2024" },
    { title: "November, 2024" },
    { title: "December, 2024" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="flex flex-nowrap items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span className="hidden whitespace-nowrap md:inline">September, 2024</span>
          <span className="inline whitespace-nowrap md:hidden">Sep, 2024</span>
          <ChevronDown className="ml-1 h-3 w-3 lg:ml-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[250px] w-48 overflow-y-auto">
        {months.map((item, index) => (
          <DropdownMenuItem
            key={index}
            className={item.active ? "bg-muted font-medium" : ""}
            asChild
          >
            <Link href="/" className="w-full">
              {item.title}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
