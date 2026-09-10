"use client";

import { generalSettings } from "@/app/(app)/_metronic/general-config";
import { Container } from "@/app/(app)/_metronic/partials/common/container";

// Ported verbatim from packages/ui's layouts/demo1/components/footer.tsx.
export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <Container>
        <div className="flex flex-col items-center justify-center gap-3 py-5 md:flex-row md:justify-between">
          <div className="order-2 flex gap-2 text-sm font-normal md:order-1">
            <span className="text-muted-foreground">{currentYear} &copy;</span>
            <a
              href="https://keenthemes.com"
              target="_blank"
              rel="noreferrer"
              className="text-secondary-foreground hover:text-primary"
            >
              Keenthemes Inc.
            </a>
          </div>
          <nav className="order-1 flex gap-4 text-sm font-normal text-muted-foreground md:order-2">
            <a
              href={generalSettings.docsLink}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              Docs
            </a>
            <a
              href={generalSettings.purchaseLink}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              Purchase
            </a>
            <a
              href={generalSettings.faqLink}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              FAQ
            </a>
            <a
              href="https://devs.keenthemes.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              Support
            </a>
            <a
              href={generalSettings.licenseLink}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              License
            </a>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
