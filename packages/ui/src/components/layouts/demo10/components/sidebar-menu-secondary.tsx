"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";

const items = [
  {
    logo: "x-dark.svg",
    title: "@keenthemes",
    path: "https://keenthemes.com/metronic/tailwind/docs/",
  },
  {
    logo: "slack.svg",
    title: "@keenthemes_hub",
    path: "https://github.com/keenthemes/",
  },
  {
    logo: "figma.svg",
    title: "metronic",
    path: "https://keenthemes.com/metronic/tailwind/docs/",
  },
];

export function SidebarMenuSecondary() {
  return (
    <div>
      <h3 className="mb-3 inline-block ps-5 text-xs text-muted-foreground uppercase">Outline</h3>
      <div className="flex w-full flex-col gap-1.5 px-3.5">
        {items.map((item, index) => (
          <Link key={index} href={item.path} className="group flex items-center gap-2.5 px-1 py-1">
            <span className="flex size-7 items-center justify-center rounded-md bg-black">
              <img
                src={toAbsoluteUrl(`/media/brand-logos/${item.logo}`)}
                className="size-3.5"
                alt={item.title}
              />
            </span>
            <span className="group-hover:text-mono text-sm text-secondary-foreground">
              {item.title}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
