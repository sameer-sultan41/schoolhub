import type { PageSection, SectionType, SiteSettings, Tenant } from "@schoolhub/types";
import type { ReactNode } from "react";

/** Props every section component receives. Sections are server components by default. */
export interface SectionProps {
  section: PageSection;
  tenant: Tenant;
}

export type SectionComponent = (props: SectionProps) => ReactNode | Promise<ReactNode>;

/** Props for the page chrome (navigation, footer). */
export interface ChromeProps {
  tenant: Tenant;
  settings: SiteSettings | null;
}

export type ChromeComponent = (props: ChromeProps) => ReactNode | Promise<ReactNode>;

/**
 * A theme = a set of section components + a token contract + a manifest.
 * Adding a theme means adding an entry to the registry — never per-tenant code
 * (website-builder.md §5).
 */
export interface Theme {
  name: string;
  label: string;
  /** Section types this theme implements. Unimplemented types render nothing. */
  sections: Partial<Record<SectionType, SectionComponent>>;
  Navigation: ChromeComponent;
  Footer: ChromeComponent;
}
