/**
 * Tenant identity, branding, and lifecycle — see
 * `DOCS/docs/02-architecture/multi-tenancy.md` §5 (configuration & branding) and §7 (lifecycle).
 *
 * Branding is the *only* source of brand colour in the frontend. It is projected into CSS
 * custom properties at render time; no component may hardcode a brand colour.
 */

export type TenantStatus =
  | "provisioning"
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "closed";

/**
 * The theme token contract (website-builder.md §2). Every token is optional on the wire —
 * missing tokens fall back to the theme's declared defaults, never to a hardcoded brand value.
 */
export interface TenantBranding {
  /** Primary brand colour as a CSS colour string (hex, rgb(), oklch(), …). */
  primary_color?: string | null;
  secondary_color?: string | null;
  accent_color?: string | null;
  /** Page background and foreground for the public site. */
  background_color?: string | null;
  foreground_color?: string | null;
  /** Font family stacks. */
  heading_font?: string | null;
  body_font?: string | null;
  logo_url?: string | null;
  logo_dark_url?: string | null;
  favicon_url?: string | null;
  /** Corner radius token, e.g. "0.5rem". */
  radius?: string | null;
}

export interface TenantLocaleSettings {
  /** Default locale, e.g. `en` or `ur`. */
  default_locale: string;
  /** Locales the tenant has enabled. */
  enabled_locales: string[];
  timezone: string;
  direction: "ltr" | "rtl";
}

export interface TenantContact {
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  map_embed_url?: string | null;
}

export interface Tenant {
  id: string;
  /** Wildcard subdomain label: `<slug>.<platform-domain>`. */
  slug: string;
  name: string;
  status: TenantStatus;
  branding: TenantBranding;
  locale: TenantLocaleSettings;
  contact?: TenantContact;
  /** Verified custom domain, when one is active. Canonical host if present. */
  custom_domain?: string | null;
  /** Modules enabled for the tenant's plan; every module also re-checks server-side. */
  enabled_modules?: string[];
}

/** How the renderer resolved the tenant from the incoming `Host` header. */
export type TenantHostKind = "subdomain" | "custom-domain";

export interface ResolvedTenantHost {
  kind: TenantHostKind;
  /** Normalised host, lowercased and without the port. */
  host: string;
  /** Present only for `kind === "subdomain"`. */
  slug?: string;
}
