import type { ReactNode } from "react";
import { resolveTenant } from "@/lib/tenant";
import { themeStyle } from "@/themes/default";
import "./globals.css";

/**
 * Root layout. The tenant's branding is applied here as CSS custom properties, so every
 * section below renders in the school's colours with no per-tenant code.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const resolution = await resolveTenant();
  const tenant = resolution.status === "unknown" ? null : resolution.tenant;
  const locale = tenant?.locale.default_locale ?? "en";
  const dir = tenant?.locale.direction ?? "ltr";

  return (
    <html lang={locale} dir={dir} style={themeStyle(tenant?.branding)}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
