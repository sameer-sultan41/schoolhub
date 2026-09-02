import type { PageSection, Tenant } from "@schoolhub/types";

export function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "t1",
    slug: "cityschool",
    name: "City School",
    status: "active",
    branding: {},
    locale: {
      default_locale: "en",
      enabled_locales: ["en"],
      timezone: "Asia/Karachi",
      direction: "ltr",
    },
    ...overrides,
  };
}

export function makeSection(props: Record<string, unknown> = {}): PageSection {
  return { id: "s1", type: "hero", position: 0, props };
}
