import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, noContent, ok } from "../envelope";
import { compareValues, pageOf } from "../list";
import type { MockApi, MockModule, MockRequest } from "../router";
import { refuse, type WebsiteSettings } from "./website";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them. */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time (L41). */
export type NavigationMenu = Writable<ApiSchemas["NavigationMenu"]>;
export type CustomDomain = Writable<ApiSchemas["CustomDomain"]>;
export type ContactSubmission = Writable<ApiSchemas["ContactSubmission"]>;
type DomainErrorCode = ApiSchemas["CustomDomainErrorCodeEnum"];
type NavItem = ApiSchemas["NavItem"];
type SettingsWrite = Partial<Writable<WebsiteSettings>>;

const STAMP = "2026-11-01T00:00:00Z";
const ACTED_AT = "2026-11-16T00:00:00Z";
/** `WEBSITE_CNAME_TARGET` in the e2e stack. */
export const CNAME_TARGET = "sites.schoolhub.e2e.test";
/** `MAX_CUSTOM_DOMAINS`. */
const MAX_DOMAINS = 5;
/** `PLATFORM_DOMAIN` in the e2e stack. */
const PLATFORM_DOMAIN = "schoolhub.e2e.test";
/** `NAV_MAX_ITEMS`. */
const NAV_MAX_ITEMS = 50;

export function buildNavigationMenu(
  location: NavigationMenu["location"],
  items: NavItem[] = [],
): NavigationMenu {
  return { location, items, updated_at: STAMP };
}

/** The records `CustomDomainSerializer` sends: the TXT to remove later, the CNAME to keep. */
function dnsRecords(domain: string, token: string): CustomDomain["dns_records"] {
  return [
    {
      type: "TXT",
      name: `_schoolhub-verify.${domain}`,
      value: token,
      keep_after_verification: false,
    },
    { type: "CNAME", name: domain, value: CNAME_TARGET, keep_after_verification: true },
  ];
}

export function buildCustomDomain(overrides: Partial<CustomDomain> = {}): CustomDomain {
  const domain = overrides.domain ?? "www.greenfield.edu.pk";
  return {
    id: uuid(),
    domain,
    status: "pending_dns",
    tls_status: "pending",
    is_primary: false,
    verified_at: null,
    last_error: "",
    last_error_code: null,
    dns_records: dnsRecords(domain, `token-${domain}`),
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** Whoever triages in the stub: the server sets `handled_by_id` to the caller on a PATCH. */
const HANDLER_ID = "00000000-0000-4000-b000-000000000001";

/** A message sent with no page named; `handled_by_id` is null until someone triages it. */
export function buildContactSubmission(
  overrides: Partial<ContactSubmission> = {},
): ContactSubmission {
  const status = overrides.status ?? "new";
  return {
    id: uuid(),
    name: "Ayesha Khan",
    email: "ayesha@example.com",
    phone: "",
    subject: "Admissions for grade 3",
    message: "Is there a place in grade 3?",
    source_page_id: null,
    status,
    handled_by_id: status === "new" ? null : HANDLER_ID,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export interface WebsiteSiteOptions {
  /** The same object given to `websitePagesModule`, which answers its `GET`: a save here is what
   * the next read sees. */
  settings: WebsiteSettings;
  /** Held by reference, so a spec can read what a save left behind. */
  menus?: NavigationMenu[];
  domains?: CustomDomain[];
  /** What a DNS check finds, by domain: `"pass"`, or the code a failed or inconclusive check
   * records. A domain with no entry finds no TXT record. */
  dns?: Record<string, "pass" | DomainErrorCode>;
  submissions?: ContactSubmission[];
}

/**
 * The site screens' writes and the domains and inbox routes, in the server's shapes and words
 * (lesson L5):
 * - `PATCH /website-settings` merges the fields it is sent;
 * - a menu holds at most 50 links, two levels deep (`depth_exceeded`, `too_many_items`);
 * - a domain is normalised and refused as the server does (`invalid_domain`,
 *   `platform_domain`, `duplicate_domain`, `domain_limit`); `:verify` activates on a pass (HTTPS
 *   stays pending: v1's null provisioner), fails with the code otherwise, keeps the status on an
 *   inconclusive lookup, and answers 409 `domain_taken` with `meta.reason`; primary needs an
 *   active domain with HTTPS issued (`not_active`, `tls_not_issued`);
 * - the inbox filters by status, received range and search, newest first, and a `PATCH` writes
 *   only `status`.
 *
 * Whether the server enforces any of this is the backend suite's.
 */
export function websiteSiteModule(options: WebsiteSiteOptions): MockModule {
  return (api) => {
    const { settings } = options;
    const menus = options.menus ?? [];
    const domains = options.domains ?? [];
    const dns = options.dns ?? {};
    const submissions = options.submissions ?? [];

    api.patch("/website-settings", (request) => {
      Object.assign(settings, (request.json() as SettingsWrite | null) ?? {}, {
        exists: true,
        updated_at: ACTED_AT,
      });
      return ok(settings);
    });

    api.get("/navigation-menus", () => ok(menus));
    api.patch("/navigation-menus/:location", (request) => {
      const menu = menus.find((entry) => entry.location === request.params["location"]);
      if (!menu) return fail(404, "Not found.");
      const items = (request.json() as { items?: NavItem[] } | null)?.items ?? [];
      const count = items.reduce((total, item) => total + 1 + (item.children?.length ?? 0), 0);
      if (count > NAV_MAX_ITEMS) {
        return refuse("items", "too_many_items", "a menu holds at most 50 links.");
      }
      // A sub-link arrives with `children: []`; one with sub-links of its own is a third level.
      const deep = items.findIndex((item) =>
        (item.children ?? []).some((child) => (child.children?.length ?? 0) > 0),
      );
      if (deep >= 0) {
        return refuse(`items.${String(deep)}`, "depth_exceeded", "menus go two levels deep.");
      }
      Object.assign(menu, { items, updated_at: ACTED_AT });
      return ok(menu);
    });

    stubDomains(api, domains, dns);
    stubInbox(api, submissions);
  };
}

function stubDomains(
  api: MockApi,
  domains: CustomDomain[],
  dns: Record<string, "pass" | DomainErrorCode>,
) {
  const find = (request: MockRequest, key: string) =>
    domains.find((domain) => domain.id === request.params[key]);

  api.get("/custom-domains", (request) =>
    pageOf(
      [...domains].sort((a, b) => compareValues(a.domain, b.domain)),
      request.searchParams,
    ),
  );

  api.post("/custom-domains", (request) => {
    const raw = (request.json() as { domain?: string } | null)?.domain ?? "";
    const name = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name) || /^\d+$/.test(name.split(".").pop() ?? "")) {
      return refuse("domain", "invalid_domain", "enter a domain name such as www.example.org.");
    }
    if (name === PLATFORM_DOMAIN || name.endsWith(`.${PLATFORM_DOMAIN}`)) {
      return refuse(
        "domain",
        "platform_domain",
        "use your own domain, not one under the platform's.",
      );
    }
    if (domains.length >= MAX_DOMAINS) {
      return refuse("domain", "domain_limit", "a school can add at most 5 domains.");
    }
    if (domains.some((domain) => domain.domain === name)) {
      return refuse("domain", "duplicate_domain", "this school has already added this domain.");
    }
    const created = buildCustomDomain({ domain: name, created_at: ACTED_AT, updated_at: ACTED_AT });
    domains.push(created);
    return ok(created, { status: 201, meta: { message: "Domain added." } });
  });

  // `router.ts` reads `:name` as a param, so `/custom-domains/{id}:verify` lands here whole.
  api.post("/custom-domains/:domainAction", (request) => {
    const [domainId, action] = (request.params["domainAction"] ?? "").split(":");
    const domain = domains.find((entry) => entry.id === domainId);
    if (!domain || action !== "verify") return fail(404, "Not found.");
    if (domain.status === "active") return ok(domain);
    if (domain.status === "disabled") {
      return refuse("status", "not_verifiable", "this domain cannot be verified.");
    }
    const found = dns[domain.domain] ?? "txt_missing";
    domain.updated_at = ACTED_AT;
    if (found === "pass") {
      Object.assign(domain, {
        status: "active",
        verified_at: ACTED_AT,
        last_error: "",
        last_error_code: null,
      });
      return ok(domain, { meta: { message: "Domain verified." } });
    }
    if (found === "lookup_timeout" || found === "lookup_failed") {
      Object.assign(domain, {
        last_error: "The DNS lookup did not finish.",
        last_error_code: found,
      });
      return ok(domain, { meta: { message: "Verification failed." } });
    }
    Object.assign(domain, { status: "failed", last_error: `${found}.`, last_error_code: found });
    if (found === "domain_taken") {
      const issue = "domain_taken: this domain is in use by another school.";
      return fail(409, issue, {
        details: [{ field: "domain", issue }],
        meta: { reason: "domain_taken" },
      });
    }
    return ok(domain, { meta: { message: "Verification failed." } });
  });

  api.patch("/custom-domains/:domainId", (request) => {
    const domain = find(request, "domainId");
    if (!domain) return fail(404, "Not found.");
    const isPrimary = (request.json() as { is_primary?: boolean } | null)?.is_primary ?? false;
    if (isPrimary && domain.status !== "active") {
      return refuse("is_primary", "not_active", "only an active domain can be the primary domain.");
    }
    if (isPrimary && domain.tls_status !== "issued") {
      return refuse(
        "is_primary",
        "tls_not_issued",
        "the domain's HTTPS certificate is not issued yet.",
      );
    }
    if (isPrimary) for (const other of domains) other.is_primary = false;
    Object.assign(domain, { is_primary: isPrimary, updated_at: ACTED_AT });
    return ok(domain, { meta: { message: "Domain updated." } });
  });

  api.delete("/custom-domains/:domainId", (request) => {
    const domain = find(request, "domainId");
    if (!domain) return fail(404, "Not found.");
    domains.splice(domains.indexOf(domain), 1);
    return noContent();
  });
}

function stubInbox(api: MockApi, submissions: ContactSubmission[]) {
  const find = (request: MockRequest) =>
    submissions.find((entry) => entry.id === request.params["submissionId"]);

  api.get("/contact-submissions", (request) => {
    const params = request.searchParams;
    const status = params.get("status");
    const from = params.get("created_at__gte");
    const before = params.get("created_at__lt");
    const search = params.get("search")?.toLowerCase();
    const matching = submissions.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!from || Date.parse(entry.created_at) >= Date.parse(from)) &&
        (!before || Date.parse(entry.created_at) < Date.parse(before)) &&
        (!search ||
          `${entry.name} ${entry.email} ${entry.subject} ${entry.message}`
            .toLowerCase()
            .includes(search)),
    );
    // `ordering = ["-created_at", "id"]`.
    const ordered = [...matching].sort(
      (a, b) => -compareValues(a.created_at, b.created_at) || compareValues(a.id, b.id),
    );
    return pageOf(ordered, params);
  });

  api.get("/contact-submissions/:submissionId", (request) => {
    const entry = find(request);
    return entry ? ok(entry) : fail(404, "Not found.");
  });

  api.patch("/contact-submissions/:submissionId", (request) => {
    const entry = find(request);
    if (!entry) return fail(404, "Not found.");
    const status = (request.json() as { status?: ContactSubmission["status"] } | null)?.status;
    if (!status) return fail(400, "This field is required.");
    Object.assign(entry, { status, handled_by_id: HANDLER_ID, updated_at: ACTED_AT });
    return ok(entry);
  });
}
