import Image from "next/image";
import Link from "next/link";
import type { ChromeProps } from "@/themes/types";

/** Header navigation from the CMS `header` menu; the API drops unpublished targets. */
export function Navigation({ tenant, site }: ChromeProps) {
  const items = site?.navigation.header ?? [];
  const logoUrl = tenant.branding.logo_url;

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          {logoUrl ? (
            <Image src={logoUrl} alt="" width={40} height={40} className="size-10 object-contain" />
          ) : null}
          <span className="font-heading text-lg font-semibold text-foreground">{tenant.name}</span>
        </Link>

        {items.length > 0 ? (
          <nav aria-label="Primary">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              {items.map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  <Link href={item.href} className="text-foreground/80 hover:text-foreground">
                    {item.label}
                  </Link>
                  {item.children.length > 0 ? (
                    <ul className="mt-1 space-y-1 ps-3 text-xs">
                      {item.children.map((child) => (
                        <li key={`${child.href}-${child.label}`}>
                          <Link
                            href={child.href}
                            className="text-foreground/70 hover:text-foreground"
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
