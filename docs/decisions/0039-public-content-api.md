# 0039. The public content API: a platform machine client, host-resolved tenancy, a media redirect honouring file visibility, and custom domains owned by website_cms

- **Status:** Accepted
- **Date:** 2026-11-16
- **Enforced by:** `core/rbac/tests/test_machine.py` (rotated tokens both accepted, a wrong or missing token 401, an empty setting rejects everything, the scope check, a machine token refused on CMS routes, a staff JWT refused on public routes, the per-host throttle bucket and its limit, `client_ip`); `website_cms/tests/test_hosts.py` (platform subdomain, multi-label, case and port, active route only, deleted tenant, a rival's pending claim, the composite foreign key between a route's tenant and its domain's tenant); `website_cms/public/tests/test_views.py` (wrong host never returns another school's content, `by-host` for suspended and deprovisioned schools and its withheld fields, 404 for an unpublished site or a disabled module, preview rules, branding filter, homepage at `/` only, exact key sets, bounded query counts); `public/tests/test_content.py` (feeds, `page_size`, all-day events, album cap, detail 404s, query counts); `public/tests/test_files.py` (only `ready` and `public`, one identical 404, presign lifetime at least twice the cache age, throttle per IP and file); `public/tests/test_contact.py` (body cap, content type, `Origin`, honeypot, idempotency, throttles, CORS); `tests/test_endpoint_contracts.py::PublicEndpointContractTests` (every public route is machine-guarded with a registered scope or on the anonymous allowlist with its own throttle and no authentication classes); `tests/test_throttle_rates.py` (rates, `NUM_PROXIES` wiring, production refuses to boot without it); `tests/test_env_example.py`; `tests/test_import_boundaries.py` (no cross-app `views`, `urls` or `tasks` imports, which keeps `public.py` the only surface); the `public.py` tests in `staff_management`, `school_organization` and `communication`. The daily recheck rule (decision 8) is tested with PR D's custom-domain services. Keeping `public.py` read-only and free of `website_cms` imports is review only

## Context

The renderer (`apps/website`) already sent a bearer token and read eleven paths that the API did
not have. [website-builder.md](../02-architecture/website-builder.md) §6 requires it to be a
zero-write, minimum-privilege client, and [api-architecture.md](../02-architecture/api-architecture.md)
§2.2 promised "scoped machine tokens". No such authentication existed: the only auth class was
the JWT one, and the only public precedents were the payment callback and the emailed-link
views. One renderer serves every school, so every public read must also resolve its tenant from
the request, without a session and without bypassing invariant 1.

The plan is [`docs/superpowers/plans/2026-11-15-website-cms.md`](../superpowers/plans/2026-11-15-website-cms.md);
the contract is in [website-cms.md](../03-modules/website-cms.md) §16.

## Decision

1. **One platform machine client, not a role.** `MACHINE_CLIENTS` in settings maps
   `website-renderer` to `{tokens_setting: "WEBSITE_MACHINE_TOKENS", scopes:
   ["website.public-content.view"]}`. The setting is a comma-separated list, newest first, so a
   token rotates with overlap (as `INTEGRATIONS_ENCRYPTION_KEYS` does); every token is compared
   with `hmac.compare_digest` and an empty list rejects everything. `MachineTokenAuthentication`,
   `HasMachineScope` and `MachineClientThrottle` live in `core/rbac/machine.py` and are set per
   view, never in `DEFAULT_AUTHENTICATION_CLASSES`. The scope lives in `MACHINE_SCOPES`, not in
   the role registry, so no grantable `Permission` row exists and no person can hold it. The
   principal has no user and no tenant, so machine views never call `record_audit`.
2. **The tenant comes from `?host=`.** `website_cms.hosts.resolve_host` normalises the host
   (`core/tenancy/hosts.py::normalise_host`: lowercase, no port or trailing dot, IDNA, LDH
   labels, 253 characters) and matches exactly one label under `PLATFORM_DOMAIN` by slug, or an
   active `custom_domain_routes` row of a non-deleted tenant (its status is judged per read). Reads then bind `tenant_atomic`, so RLS
   applies as it does everywhere. Every read answers one 404 for an unknown host, a school that
   is not operational, `module.website` off, or a site that is unpublished or in maintenance;
   `tenants/by-host` reports the status instead and withholds contact, domain and modules
   unless the school and site are live. The throttle is 1200/min per normalised host.
3. **Media is a redirect that honours file visibility.**
   `GET /public/files/{tenant_id}/{file_id}` is anonymous and answers 302 to a presigned link
   for a `ready`, `public`, live file of an operational school, with the same 404 for every
   other case. `Cache-Control: public, max-age=300`; the presigned link lives 3600 s. Visibility
   is recomputed from published content (`sync_file_visibility`), so a draft's file is never
   served. The accepted cost: a link issued before an unpublish works for up to about 65
   minutes. Its throttle is keyed per (IP, file) so the renderer's image optimiser is not
   starved.
4. **Owners expose reads through a `public.py`.** `website_cms` reads teachers, departments,
   classes, notices and the campus contact only through a read-only `public.py` in the owning
   app. It is called inside a bound tenant, returns frozen dataclasses, runs a constant number
   of queries, and imports nothing from `website_cms`. This is ADR-0013's dependency direction
   applied to a read model: another app's `views`, `urls` and `tasks` stay off limits, and
   nothing is duplicated into `website_cms` tables.
5. **Anonymous routes are an explicit allowlist.** The payment callback, the file redirect and
   the contact `POST` carry no authentication classes and their own throttles.
   `PublicEndpointContractTests` fails on any other public route that is not machine-guarded.
6. **Client IPs and `NUM_PROXIES`.** `core.api.client_ip.client_ip` is the single derivation of
   a client IP: with `NUM_PROXIES` set it takes the N-th address from the right of
   `X-Forwarded-For`, otherwise `REMOTE_ADDR`, and returns `None` for anything that is not an
   IP. DRF's own `NUM_PROXIES` setting is wired to the same value for its throttles. Production
   refuses to boot without it (`0` means no proxy) and the Terraform environments take a
   required `num_proxies` input with no default, so a missing value fails at plan time.
7. **Custom domains belong to `website_cms`.** The module owns the `website.*` keys and is the
   only consumer; putting the table in `core.tenancy` would collide with platform-admin's
   in-flight migrations. `custom_domains` is a tenant-owned table under RLS with `unique(tenant,
   domain)` among live rows (a claim is not globally unique), a CHECK that only an `active`
   domain is primary, and a unique `(id, tenant)` pair. `custom_domain_routes(domain unique,
   tenant, custom_domain)` is the **platform-scope route table**: no RLS, one row per active
   domain, written in the same transaction as activation, disable or delete, always filtered by
   both `custom_domain_id` and `tenant_id`. A composite foreign key
   `(custom_domain_id, tenant_id) -> custom_domains (id, tenant_id)` makes the database refuse
   a route whose tenant is not its domain's tenant; referential checks bypass RLS, so it holds
   even with no tenant bound. This is the denormalised read model platform-admin chose for its
   own cross-tenant lookup. Global uniqueness applies to active routes only, and DNS proof (a
   TXT token plus a CNAME to `WEBSITE_CNAME_TARGET`) decides who gets one.
8. **An active domain is re-verified daily, on definite results only.** A definite failure
   is a missing or wrong CNAME, or a TXT record that is present but holds another token (the
   domain was handed to someone else). A TXT record that is simply absent passes, because the
   CNAME already proves the domain still points at us. An inconclusive result (a timeout, no
   nameservers, no resolver configuration) never counts: it changes nothing, so a resolver
   outage cannot lapse every school's domain. Three consecutive definite failures
   (`ACTIVE_RECHECK_FAILURE_LIMIT`, `consecutive_failures`) make the domain `failed`, drop its
   route and notify the school; the site falls back to the subdomain, never to another school's
   content. A domain is the `is_primary` host only while `tls_status = issued`. Activating a
   domain evicts a route held by a soft-deleted tenant, so a deleted school cannot block the
   name.
9. **Preview is a header.** A signed, 600-second, page-bound token goes in `X-Preview-Token`,
   never a query string. A valid token reads its own page in any status, and `site` with it
   skips the "live" check (so a school can preview before its first publish) but never the
   operational-school or module checks. The response is `no-store` and always varies on the
   header.

## Alternatives considered

| Decision | Rejected | Why |
| --- | --- | --- |
| Renderer auth | Anonymous public reads | An open read API invites enumeration of every school; the token costs one header. |
| Renderer auth | A token per school | One renderer serves every school, so it would hold N secrets and provisioning would have to distribute them. |
| Renderer auth | A scope as a role permission | It would sync a grantable `Permission` row that a person could hold. |
| Tenant on reads | The renderer asserts a `tenant_id` | A renderer bug could assert the wrong school; with `host` the API stays the only resolver. |
| Media | A public bucket or a CDN prefix | Needs bucket-policy and object-copy infrastructure; the redirect gives stable URLs today, honours visibility, and a CDN can front it later without a contract change. |
| Cross-tenant host lookup | `BYPASSRLS`, a `SECURITY DEFINER` function or a policy clause | Each widens invariant 1's surface; the route table is a plain table with no tenant data. |
| Custom domains | Global `unique(domain)` on claims | A school could squat a domain it does not own by leaving it pending. |
| Custom domains | `core.tenancy` or `platform_admin` as owner | Migration collision and the wrong owner for `website.*` keys. |
| Domain recheck | A CNAME-only recheck | It misses a domain re-verified by another party; the foreign TXT token is the signal. |
| Other modules' data | `website_cms` querying their models, or owners pushing snapshots | The first couples to their schemas; the second duplicates tables to keep in sync. |
| Client IP | A hand-rolled `X-Forwarded-For` parser per throttle | One `client_ip`, with DRF's own setting for its throttles, avoids two rules. |

## Consequences

- A new machine client is a settings entry plus a scope in `MACHINE_SCOPES`; a new public read
  is a view inheriting `PublicContentView`.
- Every environment must set `NUM_PROXIES` to the real hop count. A wrong value is not caught
  by the boot check: too small records a proxy's address, too large trusts a client-supplied
  entry.
- Unpublishing content does not recall a file link already handed out (about 65 minutes), and
  a change of a feature flag's platform default does not revalidate the renderer's cache
  (the 300 s TTL bounds it); both are in [deferred-work.md](../deferred-work.md).
- `num_proxies = 2` is safe only once the ALB accepts traffic from CloudFront alone (the
  origin-facing managed prefix list on the ALB security group, or a CloudFront custom origin
  header checked by an ALB listener rule). Until then anyone who connects to the ALB directly
  controls `X-Forwarded-For`, so the per-IP limits (public form, login, password reset,
  invitations, payment-callback failures) and the stored audit and contact IPs are spoofable.
  This is a launch blocker in [deferred-work.md](../deferred-work.md).
- `CORS_ALLOW_CREDENTIALS` is global, so an allowed tenant origin also receives it; the
  affected routes are anonymous and use no cookies.
- Custom-domain endpoints, the verification beat and the TLS provisioner arrive in PR D on top
  of the tables and rules here.
