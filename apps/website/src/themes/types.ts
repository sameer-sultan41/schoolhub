import type { ApiSchemas } from "@schoolhub/api-client";
import type { ReactNode } from "react";

export type PublicTenant = ApiSchemas["PublicTenant"];
export type PublicSection = ApiSchemas["PublicSection"];
export type PublicSite = ApiSchemas["PublicSite"];

/** Section types the API's theme declares (`SectionTypeEnum`, generated). */
export type SectionType = ApiSchemas["SectionTypeEnum"];

/** Props every section component receives. Sections are server components by default. */
export interface SectionProps {
  section: PublicSection;
  tenant: PublicTenant;
  /** The request's host: every content read sends it (website-cms §16). */
  host: string;
  /** The page the section renders on. */
  pageId: string;
}

export type SectionComponent = (props: SectionProps) => ReactNode | Promise<ReactNode>;

/** Props for the page chrome (navigation, footer). */
export interface ChromeProps {
  tenant: PublicTenant;
  site: PublicSite | null;
}

export type ChromeComponent = (props: ChromeProps) => ReactNode | Promise<ReactNode>;

/**
 * A theme = a set of section components + a token contract + a manifest.
 * Adding a theme means adding an entry to the registry — never per-tenant code
 * (website-builder.md §5).
 */
export interface Theme {
  /** The theme's `code` in the API (`PublicSite.theme.code`). */
  name: string;
  label: string;
  /**
   * Every section type the API declares, so a new enum member fails `tsc` until the theme
   * decides about it (plan decision 6). `null` means "not rendered by this theme yet".
   */
  sections: Record<SectionType, SectionComponent | null>;
  Navigation: ChromeComponent;
  Footer: ChromeComponent;
}
