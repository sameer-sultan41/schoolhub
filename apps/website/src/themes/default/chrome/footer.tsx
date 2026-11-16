import type { ApiSchemas } from "@schoolhub/api-client";
import Link from "next/link";
import type { ChromeProps } from "@/themes/types";

type NavItem = ApiSchemas["PublicNavItem"];

function FooterLinks({ label, items }: { label: string; items: NavItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label}>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`}>
            <Link href={item.href} className="text-foreground/80 hover:text-foreground">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Footer({ tenant, site }: ChromeProps) {
  const year = new Date().getFullYear();
  const socialLinks = site?.social_links ?? [];

  return (
    <footer className="mt-auto border-t border-border bg-secondary/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:justify-between">
        <div className="space-y-2">
          <p className="font-heading font-semibold text-foreground">{tenant.name}</p>
          {tenant.contact?.address ? (
            <address className="text-sm text-foreground/75 not-italic">
              {tenant.contact.address}
            </address>
          ) : null}
          {socialLinks.length > 0 ? (
            <ul aria-label="Social media" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {socialLinks.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="text-foreground/80 capitalize hover:text-foreground"
                  >
                    {link.platform}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-foreground/60">
            © {year} {tenant.name}
          </p>
        </div>

        <FooterLinks label="Footer" items={site?.navigation.footer_primary ?? []} />
        <FooterLinks label="Footer secondary" items={site?.navigation.footer_secondary ?? []} />
      </div>
    </footer>
  );
}
