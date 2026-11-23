# Website Launch Infrastructure: Implementation Plan

> **For agentic workers:**
> - REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.
> - One implementer pass, then one `change-reviewer` pass with this plan, then one fix pass.
> - **L11 overrides (carry these into every brief):**
>   - Never commit or push without the user's go-ahead.
>   - Write the report early, and update it as you go.
>   - Never run tests, lint, typecheck, `manage.py`, `terraform fmt` or `terraform validate` locally (ADR-0007). CI runs them.
>   - Never run `terraform init`, `plan` or `apply`, or any AWS command. The guardrail hook blocks them anyway.
>   - Never touch `.env*`.
>   - Stage only your own files, by path.
>   - No AI attribution.
>   - Never `--no-verify`.
>   - `fix` commits carry a `Root cause:` line.
>   - Run `docs/07-quality/agent-lessons.md` §2 before handing back.
> - Load skills: `schoolhub-testing` for every test, `next-best-practices` for renderer changes.
> - Library mechanics come from Context7, version-matched:
>   - Terraform AWS provider `~> 6.0`: `aws_ec2_managed_prefix_list`, ECS `secrets`, `aws_wafv2_ip_set`, `scope_down_statement`;
>   - Next.js 16.3.1 (installed): build-time `NEXT_PUBLIC_*`, `images.remotePatterns`, `cacheHandler`.

**Work tier:** 2

**Goal:** Clear the website-cms launch blockers, so staging and production boot and the public website works end to end:
- the API boots, and passes its ALB health check;
- the renderer listens on the routed port, passes its health check, and reads published content;
- publishes reach the renderer, and the production WAF does not block that traffic;
- the ALB accepts CloudFront only, so `num_proxies = 2` can be trusted;
- one renderer image is promoted from staging to production unchanged (`infra/AGENTS.md` rule 5).

**Architecture:** Terraform follows the existing patterns:
- secrets are Secrets Manager ARNs in a `name → ARN` map, which the `ecs-service` execution role can read by exact ARN only;
- non-secret configuration is a plain environment map, derived from `platform_domain`.

Every per-environment value the renderer reads becomes a **server-only runtime** variable, so the image carries no environment.

```
Browser ──> CloudFront (WAF) ──origin-facing prefix list only──> ALB ──host rule──> renderer :3001
                                                                     └────────────> api :8000
renderer ──API_BASE_URL https://api.<domain>/api/v1──────> CloudFront ──> ALB ──> api      (machine token; NAT IPs exempt from the WAF rate rule)
celery-worker ──WEBSITE_REVALIDATE_URL https://<domain>/api/revalidate──> CloudFront ──> ALB ──> renderer  (HMAC, User-Agent set)
ALB health checks: api /healthz (answered before host and SSL checks), renderer /api/health (no I/O)
```

**Workspace:** worktree `/Users/avialdo/Documents/schoolhub-website-infra`, branch `chore/website-launch-infra`, stacked on `feat/website-renderer-live` (PR #196). The PR targets that branch until #196 merges.

**Spec:**
- `docs/02-architecture/hosting-deployment.md` §3, §5;
- `infra/AGENTS.md` rule 5;
- ADR-0039 Consequences;
- `docs/06-security/security.md` (`NUM_PROXIES`);
- `infra/terraform/README.md` (nothing has ever been applied).

---

## Context

Each fact below was verified by reading the file named.

| Fact | Where |
| --- | --- |
| The settings modules are `base`, `dev`, `prod` and `test`. Terraform names `config.settings.production` and `.staging`. | `apps/api/config/settings/`, `envs/*/main.tf:71` |
| `config.settings.prod` is what CI's deploy check, `wsgi.py`, `asgi.py` and `tests/prod_settings.py` load. | `.github/workflows/api.yml:208` |
| The API's `/healthz` is a plain view. Behind the ALB, the health check's Host header is the task IP, and it sends no `X-Forwarded-Proto`. Under `prod.py`, that request gets `DisallowedHost` (400) or the `SECURE_SSL_REDIRECT` 301, so the target never turns healthy. | `config/urls.py:15`, `core/api/views.py:13`, `prod.py` |
| The renderer **is** deployed (`module "website"`, port 3001, health check `/api/health`). | `envs/*/main.tf` |
| The renderer image listens on **3000** (`ENV PORT=3000`). `package.json`, compose and Terraform use **3001**. | `apps/website/Dockerfile:53` |
| The renderer has no `/api/health` route. The dashboard has none either (no `src/app/api/`). | `apps/website/src/app/api/`, `apps/dashboard/src/app/` |
| The renderer reads `API_BASE_URL`, `WEBSITE_MACHINE_TOKEN`, `REVALIDATE_WEBHOOK_SECRET` and `NEXT_PUBLIC_PLATFORM_DOMAIN`, the last in the **server** proxy. Terraform gives it `NEXT_PUBLIC_API_BASE_URL`, which it never reads. | `apps/website/src/lib/env.ts`, `proxy.ts:28` |
| Next 16.3.1 inlines every `NEXT_PUBLIC_*` that is set at `next build`, into server bundles too (`getDefineEnv` spreads `getNextPublicEnvironmentVariables()` with no client guard). A `NEXT_PUBLIC_PLATFORM_DOMAIN` set at build would freeze the proxy's apex. | `node_modules/next/dist/build/define-env.js`, `dist/lib/static-env.js` |
| `next build` needs `API_BASE_URL`, `WEBSITE_MACHINE_TOKEN` and the platform domain present (`env.ts` throws at import). CI supplies placeholders. The Dockerfile `builder` stage supplies none, and **no workflow builds the runner image**. | `.github/workflows/frontend.yml:146-155`, `apps/website/Dockerfile` |
| `NEXT_PUBLIC_API_ORIGIN` feeds the contact form's `fetch` (client, `public-api.ts:45`) and `images.remotePatterns` (`next.config.ts` via `env.build.ts`). | `apps/website/src/lib/` |
| The API reads `WEBSITE_MACHINE_TOKENS` (plaintext comma list, newest first), `WEBSITE_REVALIDATE_URL` and `WEBSITE_REVALIDATE_SECRET`. The webhook is sent by the celery worker through `http.client`, **with no `User-Agent`**. | `config/settings/base.py:39-52`, `website_cms/tasks.py:_post` |
| The production WAF runs `AWSManagedRulesCommonRuleSet` (whose `NoUserAgent_HEADER` blocks requests with no UA) and an IP rate rule at 20,000 per 5 minutes, with no scope-down. | `modules/cdn/main.tf:404-446` |
| The app security group accepts traffic from the ALB security group only. There is no service discovery. | `modules/network/main.tf:253-268` |
| The ALB accepts 443 and 80 from `0.0.0.0/0`. CloudFront's ALB origin is `https-only`. | `modules/network/main.tf:226-242`, `modules/cdn/main.tf` |
| The NAT EIPs are a network-module output. | `modules/network/outputs.tf:56` |
| The `*.<platform_domain>` wildcard record already resolves `sites.<platform_domain>`. `sites` is not a reserved label, so a school could take that slug. | `modules/cdn/main.tf`, `host.ts` `RESERVED_LABELS`, `website_cms/constants.py` `RESERVED_SUBDOMAIN_LABELS` |
| `rotate-secrets.sh` classifies secrets by name pattern and has no `*/website/*` case. Its `--rotate` writes a random value. | `infra/scripts/rotate-secrets.sh:78-85` |
| The example domains are `schoolhub.example` (production) and `staging.schoolhub.example` (staging). | `envs/*/terraform.tfvars.example` |

---

## Decisions

1. **One settings module.** Both environments use `config.settings.prod`. Their differences are values (`ENVIRONMENT`, hosts, ARNs), as staging's header requires. Recorded in `hosting-deployment.md`. A `repo-hygiene` checker, with a unittest, fails when Terraform names a module that has no file. `repo-hygiene` has no path filter, so the check also runs when the settings package changes.
2. **API health check answered first.** A `HealthCheckMiddleware`, first in `MIDDLEWARE`, answers `GET /healthz` with `{"status": "ok"}` before `CorsMiddleware`, `SecurityMiddleware` (the SSL redirect) and any `get_host()` call. This is the standard Django pattern for load-balancer probes. Adding task IPs to `ALLOWED_HOSTS` would need the metadata endpoint at boot, and exempting the redirect still leaves `DisallowedHost`. `/readyz` and every other path are unchanged.
3. **Three new Secrets Manager ARNs per environment, following the `<name>_arn` pattern:**

   | Variable | Secret holds | API env | Renderer env |
   | --- | --- | --- | --- |
   | `website_machine_tokens_arn` | all live tokens, comma-separated, newest first | `WEBSITE_MACHINE_TOKENS` | — |
   | `website_machine_token_arn` | the renderer's current token, which must be **in** the list | — | `WEBSITE_MACHINE_TOKEN` |
   | `website_revalidate_secret_arn` | the shared HMAC secret | `WEBSITE_REVALIDATE_SECRET` | `REVALIDATE_WEBHOOK_SECRET` |

   - All three are required, with no default. The revalidate secret is one ARN under two names.
   - The renderer gets a new `local.website_secrets`. The dashboard keeps `frontend_secrets`.
4. **Webhook path and User-Agent.**
   - `WEBSITE_REVALIDATE_URL = "https://${var.platform_domain}/api/revalidate"`. It goes through CloudFront, because tasks cannot reach each other directly.
   - `_post` sends `User-Agent: schoolhub-api/website-revalidate` as a module constant, so `NoUserAgent_HEADER` does not block it.
5. **WAF rate rule exempts the platform's own egress.**
   - A new `aws_wafv2_ip_set` (scope `CLOUDFRONT`, provider `aws.us_east_1`) holds the NAT EIPs as `/32`s.
   - The rate rule gets `scope_down_statement { not_statement { statement { ip_set_reference_statement { arn } } } }`.
   - The addresses come from a new `cdn` input, `waf_rate_limit_exempt_cidrs`, which each environment fills from `module.network.nat_gateway_public_ips`.
   - The managed rule groups still apply to those IPs.
6. **One image for every environment.** Every per-environment renderer value is read at runtime:
   - **Platform domain:** a server-only `PLATFORM_DOMAIN` replaces `NEXT_PUBLIC_PLATFORM_DOMAIN` in `env.ts` and the proxy. A value set at build would be frozen into the proxy.
   - **Contact form origin:** a server-only `API_PUBLIC_ORIGIN` in `env.ts`. The (server) contact-form section passes it as a prop to `PublicEnquiryForm`, and `public-api.ts` takes the origin as a parameter. The renderer is already dynamic per request, so no static page bakes it in.
   - **Image allow-list:** the one build-time value is the same in every environment. A new build variable `WEBSITE_IMAGE_HOSTNAME` (for example `**.schoolhub.example`) is used as `remotePatterns[].hostname`, with `protocol: "https"` and the existing pathname `/api/v1/public/files/**`.
     - It covers `api.schoolhub.example` and `api.staging.schoolhub.example` (Next docs: `**` matches any number of leading subdomains).
     - Tenant hosts also match the hostname, but on that path they hit the renderer, which answers 404. So the allow-list still admits only the API's file route.
     - `NEXT_PUBLIC_API_ORIGIN`, `env.client.ts` and the origin half of `env.build.ts` are removed.
     - If the user's real staging and production domains share no parent, the fallback is a comma list of hostnames, which is still one value for every environment. `unoptimized` is not used, because `image-config.ts` forbids it for https origins.
   - **Result:** no ADR, and `infra/AGENTS.md` rule 5 stands.
7. **The Dockerfile builds a runnable image.** The `builder` stage sets **non-secret placeholders**, used for `next build` only, for the server-only variables `env.ts` validates at import: `API_BASE_URL`, `WEBSITE_MACHINE_TOKEN` and `PLATFORM_DOMAIN`. Server-only variables are not inlined, and the `runner` stage does not inherit them. `ARG WEBSITE_IMAGE_HOSTNAME` is the one real build input. `PORT` becomes `3001` in the runner stage (with `EXPOSE 3001`), matching `package.json`, compose and Terraform.
8. **CI builds the runner image.** A new `frontend` job runs `docker build --target runner --build-arg WEBSITE_IMAGE_HOSTNAME=**.example.invalid -f apps/website/Dockerfile .` with no push, path-filtered like the rest of `frontend.yml`. It is the only proof that the Dockerfile builds.
9. **Renderer health route.** `GET /api/health` returns 200 with no I/O, and imports neither `@/lib/env` nor `@/lib/api`. It is added to `HOST_INDEPENDENT_PATHS`, so the apex does not rewrite it to the landing page. On an IP Host the proxy classifies a custom domain, sets headers and continues (it does no I/O), so the route answers. The matcher is not changed. Tests cover both cases.
10. **Disk cache volume.** The reviewer verified that Next warns on the read-only `.next/cache` and serves uncached, and that boot does not fail. The plan adds a non-persistent writable volume at `/app/apps/website/.next/cache`, using the same mechanism as `tmp`: a new `ecs-service` input `writable_paths` (default `[]`), each entry becoming a `volume` plus a `mountPoint`.
11. **Restrict the ALB to CloudFront in this PR.**
    - `data "aws_ec2_managed_prefix_list"` with name `com.amazonaws.global.cloudfront.origin-facing` replaces `0.0.0.0/0` on 443.
    - The port-80 ingress rule and the `http_redirect` listeners are deleted: CloudFront reaches the origin over HTTPS only, and redirects viewers itself.
    - The ALB security group's description changes now. That replaces the group, which costs nothing while nothing is applied.
12. **Reserve `sites`** in the renderer's `RESERVED_LABELS` and the API's `RESERVED_SUBDOMAIN_LABELS`, with a test on each side. The wildcard record already resolves it, so no DNS change is needed.

---

## Alternatives considered (why not)

| Alternative | Why not |
| --- | --- |
| Add `production.py` / `staging.py` (aliases or copies) | More names for one configuration. CI checks `prod` only, so an alias or copy could drift unchecked, and staging would stop rehearsing production. |
| Settings guard in `infra-terraform.yml` | That workflow is path-filtered to `infra/`, so renaming a settings module would never run the check. |
| Exempt `/healthz` from `SECURE_SSL_REDIRECT` (`SECURE_REDIRECT_EXEMPT`) and add task IPs to `ALLOWED_HOSTS` | Two mechanisms instead of one. Task IPs are only known at runtime (the ECS metadata endpoint), and a wildcard `ALLOWED_HOSTS` throws away host validation. |
| Health check on `/robots.txt` | It calls the API, so an API outage would fail every renderer task. The `ecs-service` module forbids that. |
| Per-environment website builds plus an ADR (0040) amending `infra/AGENTS.md` rule 5 | Not needed: Decision 6 makes one image work for both environments. It stays available if the user's real domains cannot share a hostname pattern. |
| Keep `NEXT_PUBLIC_*` names and simply not set them at build | This depends on a variable never being present in the build environment (CI sets `NEXT_PUBLIC_PLATFORM_DOMAIN` today). A server-only name cannot be inlined, whatever the build environment holds. |
| One JSON secret with `valueFrom` JSON keys | The Context7 provider docs document only full secret or parameter ARNs for `valueFrom`. It also breaks the one-ARN-one-value convention, and the comma list cannot select "newest" by key. |
| Internal path for the webhook and the API reads (Service Connect, Cloud Map, an internal ALB) | New resources and a new app→app rule, and it does not fix single-task revalidation (U2). |
| Raise the WAF rate limit instead of exempting the NAT IPs | That loosens the limit for every client. Exempting by IP is the documented scope-down pattern, and only the platform's own egress is exempt. |
| A CloudFront custom origin header as well as the prefix list | `X-Forwarded-For` integrity does not need it, because CloudFront always appends the real viewer IP. It blocks other distributions (a WAF bypass), but costs a shared secret in state plus a condition on every listener rule. Deferred. |
| Leave the ALB restriction to a separate PR | It is the launch precondition for `num_proxies = 2`, and it is one rule. |

---

## User decisions needed

- **U1. The image hostname pattern.** What are the real `platform_domain`s? If staging is a subdomain of production's domain, `WEBSITE_IMAGE_HOSTNAME = **.<prod domain>` serves both, and one image stands. *Recommend* making staging `staging.<prod domain>`, as the examples do. If the domains cannot share a parent, choose between a comma list of hostnames (still one image; recommended) and ADR-0040 (per-environment builds).
- **U2. Multi-task revalidation.** `revalidateTag()` invalidates one instance only (Next 16 self-hosting docs). The fix for this renderer, whose content is patched-`fetch` data and route output, is the **singular** `cacheHandler` (with `cacheMaxMemorySize: 0`) backed by shared storage, implementing `refreshTags`/`updateTags`. That means giving the renderer Redis access. Until then, the other tasks are up to `CONTENT_REVALIDATE_SECONDS` (300 s) stale. *Recommend deferring* it with an entry; it is a renderer design change.
- **U3. The dashboard has no `/api/health`** either, so its ALB health check fails too. *Recommend including* the same route and test in this PR.
- **U4.** Should the three new ARNs be required in staging? *Recommend yes.*
- **U5. Root `.env.example` lists `NEXT_PUBLIC_API_ORIGIN`.** Decision 6 renames it to `API_PUBLIC_ORIGIN`. Editing `.env*` needs the user's explicit go-ahead. *Recommend approving* the one-line rename, or leaving that file stale and listing it in the PR.
- **Values only the user knows (for `terraform.tfvars` and the deploy pipeline, not this PR):**
  - Secrets Manager names and ARNs (proposed `schoolhub-<env>/website/{machine-tokens,machine-token,revalidate-secret}`);
  - the real `platform_domain` for each environment, and the `WEBSITE_IMAGE_HOSTNAME` build value;
  - the `website_cname_target` per environment (proposed `sites.<platform_domain>`);
  - confirmation that each chain is CloudFront → ALB (`num_proxies = 2`);
  - that the account's quota `L-0EA8095F` (inbound rules per security group) is at least 55. The default is 60.

---

## Deferred (written to `docs/deferred-work.md` in this PR)

- Multi-task cache coordination with a `cacheHandler` (U2), unless it is done now.
- Dashboard runtime config: `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_PLATFORM_DOMAIN` are inlined at its build (client components `login-form.tsx` and `forgot-password-form.tsx` read them), so the dashboard image is per-environment until it gets the same runtime treatment as Decision 6. Not cheap enough for this PR: the client auth forms and `next.config.ts` rewrites need it.
- The dashboard health route, if U3 is deferred.
- **Terraform sets neither `CORS_ALLOWED_ORIGINS` nor `CSRF_TRUSTED_ORIGINS`.** `prod.py` defaults both to `[]`. Tenant-origin CORS for the public form goes through `website_cms.cors` (`check_request_enabled`), but the dashboard's cross-origin calls to `api.<domain>` and any CSRF-checked POST need them.
- **The ALB reuses the CloudFront certificate**, which is issued in us-east-1. That works only while `aws_region = "us-east-1"`; any other region needs a regional ACM certificate for the ALB.
- The CloudFront custom origin header (defence in depth).
- A `SizeRestrictions_BODY` (8 KB) check on webhook bodies with long tag lists, if bulk publishes grow past that.

---

## Global Constraints

- **Nothing is applied.** No doc may imply otherwise.
- **Existing patterns exactly:**
  - `<name>_arn` variables whose `description` states what the secret holds;
  - secrets only through `secret_arns`;
  - non-secret values only through `environment_variables`;
  - no secret value or real ARN committed (placeholder `123456789012` style).
- API secrets never reach the dashboard. The renderer's token never reaches the dashboard.
- Staging and production keep the same shape. Every change lands in both `envs/*`.
- **One image per service per commit, promoted unchanged** (`infra/AGENTS.md` rule 5). No new per-environment build argument.
- Comments are short and say why. Every comment the diff makes false is fixed:
  - `env.client.ts:8-10` (deleted with the file);
  - `base.py:39` ("the renderer's REVALIDATE_SECRET" becomes `REVALIDATE_WEBHOOK_SECRET`, reached through the public edge);
  - the "internal origin" mentions in `proxy.ts:38`, `host.ts:81` and `proxy.test.ts:116`;
  - the ALB "deliberately internet-facing" block;
  - the `num_proxies` tfvars comment;
  - `security.md`;
  - the e2e and website-builder docs that name `NEXT_PUBLIC_API_ORIGIN`.
- Docs change in the same PR.

---

## Review Focus

1. **`/healthz` under prod settings:** Host `10.0.1.5`, no `X-Forwarded-Proto`, gets 200. The middleware matches the exact path and GET/HEAD only, and `/readyz` still goes through the full stack.
2. **WAF and the webhook:** the UA header is sent; the `CommonRuleSet` rules that could still match a webhook are `SizeRestrictions_BODY` (deferred); and the NAT-IP scope-down covers both renderer reads and worker webhooks without exempting them from the managed rules.
3. **Prefix-list weight:** the IPv4 origin-facing list counts as **55** rules against `L-0EA8095F` (default 60). After the port-80 rule is deleted, the ALB group holds only that reference. The README's bootstrap list says to check the quota.
4. **IPv4 only:** the ALB is not dual-stack, so the IPv4 list is enough.
5. **Nothing else dials the ALB directly.** Renderer reads and webhooks resolve to CloudFront.
6. **No `NEXT_PUBLIC_*` value differs by environment in the renderer**, and `grep -r NEXT_PUBLIC_ apps/website/src` finds none.
7. **The image allow-list** still admits only `https` URLs on `/api/v1/public/files/**`.
8. **The Docker build** placeholders exist in `builder` only and never reach `runner`.
9. **The settings checker** fails on a missing module and passes on an existing one (unittest).
10. **Writable volumes:** `writable_paths` creates one volume and mount per path, and `tmp` is unchanged.

---

## Task 1: Settings module and its guard

**Files:** `infra/terraform/envs/{production,staging}/main.tf`, `.github/scripts/check_settings_modules.py` (new), `.github/scripts/tests/test_check_settings_modules.py` (new), `.github/workflows/repo-hygiene.yml`, `docs/02-architecture/hosting-deployment.md`.

- [ ] `DJANGO_SETTINGS_MODULE = "config.settings.prod"` in both environments, with a one-line comment.
- [ ] Checker: read every `envs/*/main.tf`, extract `config.settings.<x>`, and exit 1 with `::error file=…` if `apps/api/config/settings/<x>.py` is missing. The repo root is an argument, so tests use a temporary directory.
- [ ] Unittest: a missing module fails, an existing one passes, and a file with no setting passes.
- [ ] `repo-hygiene.yml`: steps running the unittest and then the checker, in the existing `.github/scripts` job pattern.
- [ ] `hosting-deployment.md`: one sentence saying every deployed environment uses `config.settings.prod` and differs by values.
- [ ] Commit `fix(infra): boot staging and production on config.settings.prod`, with `Root cause:` (Terraform named settings modules that were never created, and nothing checked Terraform against the settings package).

## Task 2: API health and webhook User-Agent

**Files:** `apps/api/core/api/middleware.py`, `apps/api/config/settings/base.py`, `apps/api/core/api/tests/test_health_middleware.py` (new), `apps/api/apps/website_cms/tasks.py`, `apps/api/apps/website_cms/tests/test_revalidation.py`.

- [ ] `HealthCheckMiddleware`: for GET or HEAD on exactly `/healthz`, return `JsonResponse({"status": "ok"})`; otherwise call `get_response`. Put it first in `MIDDLEWARE`. Leave the URL route in place for direct callers.
- [ ] Test: load the prod settings values (via `tests/prod_settings.py`), then `override_settings` with `DEBUG=False`, `SECURE_SSL_REDIRECT=True`, `ALLOWED_HOSTS=["api.example.com"]` and `SECURE_PROXY_SSL_HEADER` as in prod. Assert `GET /healthz` with `HTTP_HOST="10.0.1.5"` and no forwarded proto returns 200. Control: the same request to another path returns 400 or 301.
  - Mutation line: `test_health_middleware fails when base.py MIDDLEWARE lists HealthCheckMiddleware after SecurityMiddleware — not run`.
- [ ] `tasks.py`: a `REVALIDATE_USER_AGENT = "schoolhub-api/website-revalidate"` constant, sent in `_post`'s headers.
- [ ] Test: extend `test_revalidation.py` to assert that the posted headers include that `User-Agent`.
  - Mutation line: `… fails when tasks.py _post drops the User-Agent header — not run`.
- [ ] `base.py:39`: fix the comment.
- [ ] Commit: `fix(api): answer ALB health checks and identify the revalidation webhook`, with `Root cause:` (the health check's Host is the task IP and carries no forwarded proto; `http.client` sends no UA, which the WAF's managed rules block).

## Task 3: Renderer runtime configuration and health

**Files:**
- `apps/website/src/lib/env.ts`, `env.build.ts`, `image-config.ts`, `public-api.ts`;
- `env.client.ts` (deleted) and its tests;
- `apps/website/src/components/public-enquiry-form.tsx`, `src/themes/default/sections/contact-form.tsx`;
- `apps/website/src/proxy.ts`, `src/lib/host.ts`;
- `apps/website/src/app/api/health/route.ts` (new) and its test;
- `src/__tests__/proxy.test.ts`, `src/lib/__tests__/host.test.ts` and the affected `__tests__`;
- `apps/website/next.config.ts`;
- `infra/compose/docker-compose.yml`, `e2e/playwright.config.ts`, `e2e/README.md`, `.github/workflows/frontend.yml`, `turbo.json`;
- `apps/api/apps/website_cms/constants.py`, `apps/api/apps/website_cms/tests/test_hosts.py`.

- [ ] `env.ts`: `PLATFORM_DOMAIN` replaces `NEXT_PUBLIC_PLATFORM_DOMAIN`, and `API_PUBLIC_ORIGIN` (an `https?` URL; empty is allowed for same-origin) is added. Rename in the proxy and every consumer and test.
- [ ] Contact form: `contact-form.tsx` (server) reads `env.API_PUBLIC_ORIGIN` and passes `apiOrigin` to `PublicEnquiryForm`, which passes it to `public-api.ts`'s submit function. Delete `env.client.ts`.
  - If `contact-form.tsx` turns out to be a client component, move the read to its nearest server parent. Do not reintroduce `NEXT_PUBLIC_`.
  - Mutation line: the form test posts to the prop's origin; `fails when public-enquiry-form.tsx ignores apiOrigin — not run`.
- [ ] `env.build.ts` / `image-config.ts`: take `WEBSITE_IMAGE_HOSTNAME` (comma list allowed) and build one `remotePatterns` entry per hostname, with `protocol: "https"` and the existing pathname. The empty value allows no remote image, as today. Keep the `unoptimized` guard, reworded for the new input.
- [ ] Health route and test: GET returns 200 with `{ status: "ok" }`.
  - Add `"/api/health"` to `HOST_INDEPENDENT_PATHS`.
  - `proxy.test.ts`: add `["GET", "/api/health"]` to the host-independent table. Add an IP-Host case (`10.0.1.5:3001`) asserting no rewrite to `/platform-landing`.
  - Fix the "internal origin" comments (proxy, host, test).
- [ ] Reserve `sites`: in `RESERVED_LABELS` with a `host.test.ts` case (`sites.<apex>` parses to `null`), and in `RESERVED_SUBDOMAIN_LABELS` with a `test_hosts.py` case.
- [ ] Rename the variables in compose, the Playwright config, the e2e README, the `frontend.yml` build env, `turbo.json` and the website-builder doc. Not `.env.example` (U5).
- [ ] (U3, if included) the dashboard `src/app/api/health/route.ts` and its test. The dashboard proxy matcher already excludes `api/`.

## Task 4: Dockerfile and CI image build

**Files:** `apps/website/Dockerfile`, `.github/workflows/frontend.yml`, `infra/runbooks/deploy.md`.

- [ ] `builder` stage: `ARG WEBSITE_IMAGE_HOSTNAME=""` and `ENV WEBSITE_IMAGE_HOSTNAME=…`. Set build-only placeholders `API_BASE_URL=https://api.build.invalid/api/v1`, `WEBSITE_MACHINE_TOKEN=build-placeholder` and `PLATFORM_DOMAIN=build.invalid`, with a comment: server-only, not inlined, absent from `runner`.
- [ ] `runner` stage: `ENV PORT=3001`, `EXPOSE 3001`.
- [ ] `frontend.yml`: a `website-image` job (Buildx, no push, no cache export) running the build from Decision 8. It is covered by the workflow's existing path filter.
- [ ] `deploy.md`: the website image takes one build argument, `WEBSITE_IMAGE_HOSTNAME`, the same value for every environment, and is promoted unchanged.

## Task 5: Terraform wiring

**Files:**
- `infra/terraform/envs/{production,staging}/{main.tf,variables.tf,terraform.tfvars.example}`;
- `infra/terraform/modules/ecs-service/{main.tf,variables.tf}`;
- `infra/terraform/modules/cdn/{main.tf,variables.tf}`.

- [ ] `variables.tf` (both): the three `*_arn` variables, required, with descriptions.
- [ ] `local.api_secrets` (both) gets `WEBSITE_MACHINE_TOKENS` and `WEBSITE_REVALIDATE_SECRET`. `local.api_environment` gets `WEBSITE_REVALIDATE_URL`.
- [ ] `local.website_secrets` (both): production merges `frontend_secrets`; staging uses the conditional Sentry pattern. Add `WEBSITE_MACHINE_TOKEN` and `REVALIDATE_WEBHOOK_SECRET`, and set `module "website"` `secret_arns` to it.
- [ ] `module "website"` environment: remove `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_PLATFORM_DOMAIN`. Add `API_BASE_URL = "https://api.${var.platform_domain}/api/v1"`, `API_PUBLIC_ORIGIN = "https://api.${var.platform_domain}"` and `PLATFORM_DOMAIN = var.platform_domain`. Set `writable_paths = ["/app/apps/website/.next/cache"]`. `container_port` stays 3001, with a comment that it matches the Dockerfile's `PORT`.
- [ ] `ecs-service`: a `writable_paths` variable (list of absolute paths, default `[]`, validated as absolute). Add a dynamic `volume` per path, named from an index, and the matching `mountPoints` alongside `tmp`.
- [ ] `cdn`: a `waf_rate_limit_exempt_cidrs` variable (list, default `[]`). Add `aws_wafv2_ip_set` (count on WAF enabled and a non-empty list, provider `aws.us_east_1`, scope `CLOUDFRONT`, `IPV4`), and a `dynamic "scope_down_statement"` on the rate rule as in Decision 5. Production passes `[for ip in module.network.nat_gateway_public_ips : "${ip}/32"]`; staging passes the same, although its WAF is off.
- [ ] `terraform.tfvars.example` (both): three placeholder ARNs, with the comment "the renderer's token must be in the API's list; see `rotate-website-secrets.md`".

## Task 6: ALB accepts CloudFront only

**Files:** `infra/terraform/modules/network/main.tf`, `infra/terraform/envs/{production,staging}/main.tf`, `…/terraform.tfvars.example`, `infra/terraform/README.md`.

- [ ] Add the data source. `alb_https` uses `prefix_list_id`. The security group description becomes "Public load balancer. HTTPS from CloudFront origin-facing addresses only."
- [ ] Delete `alb_http_redirect` and both `aws_lb_listener.http_redirect`. Comment at the 443 listener: CloudFront redirects viewers to HTTPS and reaches the origin over HTTPS only.
- [ ] Rewrite the ALB comment in both environments. Keep `trivy:ignore:AVD-AWS-0053`.
- [ ] tfvars `num_proxies` comment: 2 is correct because the ALB accepts CloudFront only.
- [ ] `README.md` bootstrap: check `L-0EA8095F` ≥ 55.

## Task 7: Docs, lesson, runbook, rotation script

**Files:** `docs/deferred-work.md`, `docs/06-security/security.md`, `docs/project-status.md`, `docs/07-quality/agent-lessons.md`, `docs/02-architecture/website-builder.md`, `infra/runbooks/rotate-website-secrets.md` (new), `infra/scripts/rotate-secrets.sh`.

- [ ] `deferred-work.md`: mark the three launch-blocker entries and PR E's "Image config is fixed at build time" resolved, update the `NUM_PROXIES` entry, and add the Deferred list above.
- [ ] `security.md`: the ALB prefix-list restriction, and the WAF NAT exemption (the managed rules still apply).
- [ ] `project-status.md`: one line.
- [ ] `agent-lessons.md`: the next lesson after L73, in §4 format.
  - **Mistake:** Terraform named a settings module, port, health path and env names the apps do not have; the API's health check could never pass under `prod.py`; and a `NEXT_PUBLIC_` server value would be frozen at build.
  - **Check:** for every value Terraform passes to an app, open the file that reads it; health paths must pass under the production middleware with an IP Host; no per-environment `NEXT_PUBLIC_`.
- [ ] Runbook:
  - **Machine token:** add the new token to the front of the list secret, then redeploy the API, worker and beat. Set the renderer secret to the new token, then redeploy the renderer. Remove the old token, then redeploy the API.
  - **Revalidate secret:** rotate it, then redeploy both sides together. Webhooks fail closed meanwhile; the 300 s TTL bounds the staleness.
  - Never use `rotate-secrets.sh --rotate` on `*/website/machine-tokens`.
- [ ] `rotate-secrets.sh`: `classify` cases: `*/website/machine-tokens` is `MANUAL` (`--rotate` refuses: "a random value would drop every live token; edit the list by hand"), `*/website/machine-token` is `COORDINATED`, `*/website/revalidate-secret` is `COORDINATED`. Add the refusal in the `rotate` action.

## Task 8: Review and PR

- [ ] `change-reviewer` with this plan, then one fix pass.
- [ ] **Stop and ask the user before any commit or push.** On go-ahead:
  - `gh pr create --base feat/website-renderer-live --assignee @me --label "needs review" --label infrastructure`;
  - an ELI5 section, plus the mutation lines from Tasks 2 and 3;
  - no AI attribution.
- [ ] `gh pr checks <n> --watch` until `api`, `frontend` (including `website-image`), `infra-terraform` (fmt, validate, tflint, trivy) and `repo-hygiene` are green. Report the `plan` job's status as it is.

---

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-23
- **Verdict:** REVISE — approach right, but misses three launch blockers (API `/healthz` fails behind the ALB — DisallowedHost/SSL redirect; production WAF blocks the webhook — no User-Agent; the runner image has never been built in CI) and several premises need correcting (U2 API, disk cache, `sites.` DNS, health test, CI guard path filter, L11 brief).
- **Findings addressed:**
  1. A first-in-`MIDDLEWARE` `HealthCheckMiddleware` with a prod-settings IP-Host test (Decision 2, Task 2).
  2. The webhook `User-Agent` and its test, and WAF in Review Focus 2 (Decision 4, Task 2).
  3. A CI `docker build --target runner` job, and builder placeholders for what `env.ts` validates (Decisions 7–8, Task 4).
  4. The settings guard moved to `repo-hygiene` as a `.github/scripts` checker with a unittest (Task 1).
  5. U2 now names the singular `cacheHandler`, Next 16.3.1.
  6. The disk-cache behaviour recorded as warn-and-uncached, plus a `writable_paths` volume at `.next/cache` (Decision 10).
  7. One promoted image: runtime `API_PUBLIC_ORIGIN` passed as a prop, server-only `PLATFORM_DOMAIN` (confirmed in Next's `define-env.js` that `NEXT_PUBLIC_` is inlined into server bundles too), and `**.<domain>` image hostname checked against both example domains. No ADR; ADR-0040 kept as the fallback in U1; the dashboard deferred with reasons (Decision 6).
  8. The WAF rate rule scoped down to exclude the NAT EIPs through an IP set (Decision 5, Task 5).
  9. The health route in the proxy table plus an IP-Host case, and the rationale corrected (Decision 9).
  10. L11 overrides added: no commit or push without the user, write the report early.
  11. DNS entry dropped; `sites` reserved on both sides with tests (Decision 12).
  12. Weight 55 against `L-0EA8095F` (Review Focus 3).
  13. Rotation: tfvars "in the list"; the runbook forbids `--rotate`; `rotate-secrets.sh` classifies `*/website/*` (Task 7).
  14. The security-group description changes now (Decision 11).
  15. Stale comments listed in Global Constraints; Dockerfile `PORT=3001`.
  16. CORS/CSRF and us-east-1 certificate entries deferred.
  17. Decision 1 recorded in `hosting-deployment.md` (Task 1).
- **Unresolved:**
  - U1: real domains, and the image hostname pattern;
  - U2: defer the `cacheHandler`?
  - U3: include the dashboard health route?
  - U4: required ARNs in staging?
  - U5: go-ahead to edit `.env.example`;
  - the operator values: secret ARNs, `website_cname_target`, `num_proxies` confirmation, and the `L-0EA8095F` quota.
