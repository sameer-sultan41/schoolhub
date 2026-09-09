"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";

export function SidebarHeader() {
  return (
    <div className="hidden shrink-0 items-center justify-center pt-8 pb-3.5 lg:flex">
      <Link href="/">
        <img
          src={toAbsoluteUrl("/media/app/mini-logo-square-gray.svg")}
          className="min-h-[42px] dark:hidden"
          alt=""
        />
        <img
          src={toAbsoluteUrl("/media/app/mini-logo-square-gray-dark.svg")}
          className="hidden min-h-[42px] dark:block"
          alt=""
        />
      </Link>
    </div>
  );
}
