import Image from "next/image";
import Link from "next/link";
import type { ChromeProps } from "@/themes/types";

/** Primary navigation, built from the CMS nav placement of published pages. */
export function Navigation({ tenant, settings }: ChromeProps) {
  const items = settings?.navigation.primary ?? [];

  return (
    <header className="border-b border-black/10 bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          {(settings?.logo_url ?? tenant.branding.logo_url) ? (
            <Image
              src={(settings?.logo_url ?? tenant.branding.logo_url) as string}
              alt=""
              width={40}
              height={40}
              className="size-10 object-contain"
            />
          ) : null}
          <span className="font-heading text-lg font-semibold text-foreground">
            {settings?.school_name ?? tenant.name}
          </span>
        </Link>

        <nav aria-label="Primary">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-foreground/80 hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
