"use client";

import { type ReactNode } from "react";
import Link from "next/link";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Switch,
  toAbsoluteUrl,
} from "@schoolhub/ui";

// Ported verbatim from packages/ui's partials/topbar/apps-dropdown-menu.tsx.
interface DropdownAppsItem {
  logo: string;
  title: string;
  description: string;
  checkbox: boolean;
}

export function AppsDropdownMenu({ trigger }: { trigger: ReactNode }) {
  const items: DropdownAppsItem[] = [
    { logo: "jira.svg", title: "Jira", description: "Project management", checkbox: false },
    {
      logo: "inferno.svg",
      title: "Inferno",
      description: "Ensures healthcare app",
      checkbox: true,
    },
    {
      logo: "evernote.svg",
      title: "Evernote",
      description: "Notes management app",
      checkbox: true,
    },
    { logo: "gitlab.svg", title: "Gitlab", description: "DevOps platform", checkbox: false },
    {
      logo: "google-webdev.svg",
      title: "Google webdev",
      description: "Building web experiences",
      checkbox: true,
    },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-[325px] p-0" side="bottom" align="end">
        <div className="flex items-center justify-between gap-2.5 border-b border-b-border px-5 py-3 text-xs font-medium text-secondary-foreground">
          <span>Apps</span>
          <span>Enabled</span>
        </div>
        <div className="scrollable-y-auto flex max-h-[400px] flex-col divide-y divide-border">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-accent/60">
                  <img
                    src={toAbsoluteUrl(`/media/brand-logos/${item.logo}`)}
                    className="size-6"
                    alt={item.title}
                  />
                </div>
                <div className="flex flex-col">
                  <a href="#" className="text-mono hover:text-primary-active text-sm font-semibold">
                    {item.title}
                  </a>
                  <span className="text-xs font-medium text-secondary-foreground">
                    {item.description}
                  </span>
                </div>
              </div>
              <Switch defaultChecked={item.checkbox} size="sm" />
            </div>
          ))}
        </div>
        <div className="grid border-t border-t-border p-5">
          <Button asChild variant="outline" size="sm">
            <Link href="/account/api-keys">Go to Apps</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
