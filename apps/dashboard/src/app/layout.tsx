import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { AppProviders } from "@/components/providers";
import { directionFor } from "@/lib/env";
import { preferenceDataAttributes } from "@/lib/preferences/preferences-config";
import { readPreferencesFromCookies } from "@/lib/preferences/preferences-cookies.server";
import { PreferencesProvider } from "@/lib/preferences/preferences-provider";

import "./globals.css";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const preferences = await readPreferencesFromCookies();

  return (
    // The preference data-attributes (data-theme-preset, data-sidebar-variant,
    // data-content-layout, data-navbar-style — see lib/preferences/preferences-config.ts)
    // apply app-wide, not just under (app)/_metronic's Shell: (auth)/login has no sidebar
    // to vary, but it still wants the same colour preset, so this can't be toggled on
    // mount by Shell alone. `readPreferencesFromCookies` is what lets the first server
    // render already agree with whatever a returning viewer chose last time — no
    // hydration flash to a default before the client re-applies it.
    // dir flips the whole app to RTL for Urdu — every layout in this app uses logical
    // CSS properties (start/end, not left/right) specifically so this one switch works.
    <html
      lang={locale}
      dir={directionFor(locale)}
      suppressHydrationWarning
      {...preferenceDataAttributes(preferences)}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
            <PreferencesProvider initialValues={preferences}>
              <AppProviders>{children}</AppProviders>
            </PreferencesProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
