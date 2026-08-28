# Runbook — Custom Domain Onboarding

**Purpose.** Put a school's own domain (`www.cityschool.example`) in front of its
SchoolHub website, with a valid certificate and no downtime for the school's
existing site.

**Default state.** Every tenant already has `<slug>.<platform-domain>`, served by
the wildcard DNS record and the wildcard certificate. That works from the moment
the tenant row exists and needs no infrastructure change. A custom domain is an
addition to that, never a replacement — the subdomain keeps working, and it is
the fallback if the custom domain has a problem.

**Who does what.** DNS changes happen in the **school's** DNS provider, by the
school. We never take control of a school's domain, and we never ask for their
registrar credentials.

**Spec.** [`hosting-deployment.md`](../../docs/02-architecture/hosting-deployment.md) §4 ·
[`multi-tenancy.md`](../../docs/02-architecture/multi-tenancy.md) §4.

## Preconditions

- [ ] The tenant is Active (not Trial, not Suspended) and on a plan that includes
      custom domains.
- [ ] The tenant's website is published and correct on
      `<slug>.<platform-domain>`. **Do not onboard a custom domain onto a site
      that is not finished** — the cutover makes it public.
- [ ] The school has confirmed **who at the school can edit their DNS**, and that
      person is available. This is the step that actually delays onboardings.
- [ ] You know whether the domain currently serves a live site. If it does, this
      is a migration with a cutover window and the school must agree a time.
- [ ] Apex or subdomain is decided. An apex (`cityschool.example`) cannot take a
      plain CNAME; it needs the provider's ALIAS/ANAME support, or the school
      uses `www.` and redirects the apex. Establish this **before** promising a
      date.

## Steps

1. **Record the request** in the platform admin console: tenant, requested
   hostname, requester. This creates the domain row in `pending` state.
2. **Issue the verification token.** The console generates a TXT record proving
   the school controls the domain:
   ```
   _schoolhub-verify.www.cityschool.example.  TXT  "schoolhub-verify=<token>"
   ```
3. **Send the school both records at once** — the TXT above and the CNAME they
   will need in step 6. One email, two records, with a short note that the CNAME
   is the one that switches traffic. Splitting these across two emails is how a
   two-day onboarding becomes a two-week one.
4. **Wait for propagation and verify:**
   ```
   dig +short TXT _schoolhub-verify.www.cityschool.example
   ```
   The platform re-checks automatically every 15 minutes. Do not proceed until
   the domain shows `verified`.
5. **Add the domain to the distribution.** Append it to `custom_domain_aliases`
   in `terraform/envs/production/terraform.tfvars`, then plan and apply. ACM
   adds it to the certificate and validates it via the platform's own zone.
   **The domain must already be verified in step 4** — an unvalidated name makes
   the apply wait on ACM for 30+ minutes and then fail.
6. **Have the school point traffic at us:**
   ```
   www.cityschool.example.  CNAME  <distribution-domain>.cloudfront.net.
   ```
   For an apex, use the provider's ALIAS/ANAME to the same target.
7. **Lower the TTL first if the domain is already live.** Ask the school to drop
   it to 300 seconds at least 24 hours before cutover, so a rollback is minutes
   rather than a day.
8. **Activate** the domain in the console. The renderer now resolves this
   hostname to this tenant.
9. **Restore the TTL** to its normal value a week after a clean cutover.

## Verification

1. **Certificate covers the domain:**
   `openssl s_client -connect www.cityschool.example:443 -servername www.cityschool.example </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
2. **HTTPS serves the right school:** `curl -sI https://www.cityschool.example`
   returns 200, and the page shows **this** school's branding.
3. **The wrong-tenant check — the one that matters.** Request the new domain and
   a different tenant's domain in quick succession and confirm each returns its
   own content. The CDN cache key includes `Host`; if that ever regresses, this
   is where it shows up, and the consequence is one school's pages served under
   another school's domain.
4. **HTTP redirects to HTTPS:** `curl -sI http://www.cityschool.example` returns
   301 to the `https://` URL.
5. **HSTS is present:** the response carries
   `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
6. **The platform subdomain still works.** `<slug>.<platform-domain>` must keep
   resolving — it is the fallback.
7. **Certificate expiry monitoring** now covers the new hostname. A custom domain
   that silently expires in 90 days is a scheduled outage.
8. **Confirm with the school** that they see their site on their domain, from
   their own network. Their word, not your `curl`.

## Rollback

1. **Ask the school to revert the CNAME** to whatever it was before. This is the
   real rollback and it is entirely in their hands — which is why step 7 matters.
2. Set the domain back to `pending` in the console so the renderer stops
   accepting it.
3. **Leave the alias on the distribution for now.** Removing it triggers a
   certificate change, and doing that during a failed cutover adds a slow,
   irreversible step to an already bad moment. Remove it in a later planned
   apply.
4. Point the school at `<slug>.<platform-domain>`, which is still live and
   correct.
5. If the failure was a certificate that never validated, the usual cause is a
   CAA record on the school's domain that does not permit Amazon as an issuer.
   Ask them to check `dig CAA cityschool.example`.
6. If the failure was wrong-tenant content, **treat it as SEV1** under
   [`incident.md`](incident.md) — that is cross-tenant exposure, not a DNS
   problem.
