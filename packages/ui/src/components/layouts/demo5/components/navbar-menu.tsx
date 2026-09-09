"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavbarMenu() {
  const pathname = usePathname();

  const items = useMemo(
    () => [
      {
        title: "Dashboards",
        path: "/",
        partial: "/",
      },
      {
        title: "Public Profiles",
        path: "/public-profile/profiles/default",
        partial: "/public-profile",
      },
      {
        title: "Account Settings",
        path: "/account/home/get-started",
        partial: "/account",
      },
      {
        title: "Network",
        path: "/network/get-started",
        partial: "/network",
      },
      {
        title: "User Management",
        path: "/user-management/users",
        partial: "/user-management",
      },
      {
        title: "Store - Client",
        path: "/store-client/home",
        partial: "/store-client",
      },
      {
        title: "Authentication",
        path: "/authentication/get-started",
        partial: "/authentication",
      },
    ],
    [], // Empty dependency array since the data is static
  );

  const [selectedItem, setSelectedItem] = useState(items[0]);

  useEffect(() => {
    items.forEach((item) => {
      if (item.partial !== "" && pathname.startsWith(item.partial)) {
        setSelectedItem(item);
      }
    });
  }, [items, pathname]);

  return (
    <div className="grid">
      <div className="kt-scrollable-x-auto">
        <div className="flex h-12 items-stretch gap-5 lg:gap-7.5">
          {items.map((item, index) => (
            <Link
              key={index}
              href={item.path}
              className={cn(
                "flex items-center text-sm font-medium text-nowrap text-secondary-foreground",
                item.path === selectedItem.path && "border-mono text-mono border-b",
              )}
            >
              {item.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
