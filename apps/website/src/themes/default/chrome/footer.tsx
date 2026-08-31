import Link from "next/link";
import type { ChromeProps } from "@/themes/types";

export function Footer({ tenant, settings }: ChromeProps) {
  const items = settings?.navigation.footer ?? [];
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-border bg-secondary/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:justify-between">
        <div className="space-y-2">
          <p className="font-heading font-semibold text-foreground">
            {settings?.school_name ?? tenant.name}
          </p>
          {tenant.contact?.address ? (
            <address className="text-sm text-foreground/75 not-italic">
              {tenant.contact.address}
            </address>
          ) : null}
          <p className="text-xs text-foreground/60">
            © {year} {settings?.school_name ?? tenant.name}
          </p>
        </div>

        {items.length > 0 ? (
          <nav aria-label="Footer">
            <ul className="space-y-2 text-sm">
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-foreground/80 hover:text-foreground">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </footer>
  );
}
