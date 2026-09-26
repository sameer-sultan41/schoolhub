# Project Status — SchoolHub

Living hand-off note: what exists and where the next session should start — across the
backend, both frontends, and infra. What is deliberately missing, and why, is in
[`deferred-work.md`](deferred-work.md).
**Update this file in the same PR as the work it describes.**

Specification (source of truth): [`./`](./) — this directory
Read [`../AGENTS.md`](../AGENTS.md) first — especially the context-map rule.

---

## Where we are in the plan

[`01-phases/phase-plan.md`](01-phases/phase-plan.md) → we are in **Phase 2 (Core
Build)**, per [`01-phases/phase-2-core-build.md`](01-phases/phase-2-core-build.md).

| Tier | Modules | Status |
| ---- | ------- | ------ |
| 0 — Foundation | tenancy, auth/RBAC, [`school-organization`](03-modules/school-organization.md) | Done in substance — tenancy/RBAC/audit/API plumbing in `apps/api/core/`, `school_organization` Django app shipped and merged |
| 1 — People | [`student-management`](03-modules/student-management.md), [`staff-management`](03-modules/staff-management.md) | **Both full-stack complete** — `student-management` (PRs 1-4) and `staff-management` (this PR), see the per-module matrix below |
| 2 — Daily ops | [`academics`](03-modules/academics.md), [`timetable`](03-modules/timetable.md), [`attendance`](03-modules/attendance.md) | **Backend complete.** `academics` and `timetable` shipped; `attendance` shipped as three stacked PRs (marking → leave → staff/reports). `academics`/`attendance` dashboard screens were never built; `timetable`'s were built, then removed along with every other business route by the `apps/dashboard` shell reset (see `docs/metronic-dashboard-shell.md`) — none exist on disk right now. Build order is `academics → timetable → attendance`, not the order the phase doc lists them: timetable needs academics' `teacher_subject_allocations` as its scheduling input, and attendance's period mode needs timetable |
| 3 — High-stakes | [`examinations`](03-modules/examinations.md), [`fees-finance`](03-modules/fees-finance.md) | **`examinations` backend complete** — all five stacked PRs landed (setup → scheduling/admit cards → marks → results/report cards → reports/question banks), all 11 §15 tables, all §4 keys, all six §12 notifications. `fees-finance` is **backend complete** — all four stacked PRs landed (ledger + fee config → invoicing → collection → spend/reports), 18 of its 22 tables, all of §4's permission keys, §13's eight reports. Payroll's four tables are deliberately deferred to ship with `hr-leave`, since `payslips.lop_days` comes from that module. **Tier 3 is done.** **The earlier "blocked on its own spec" note was stale** — `03-modules/fees-finance.md` (§1-§19) and `05-database/entities/finance.md` (all 22 tables, column level) were both already complete. Payroll's four tables are deliberately deferred to ship with `hr-leave`, since `payslips.lop_days` comes from that module |
| 4 — Outward | [`communication`](03-modules/communication.md), parent-portal | **`communication` in flight**, PR A merged (#62): tenant-editable per-channel notification templates and per-user channel preferences, both wired into `core/notifications` (which already owns `notifications`/`delivery_logs`/`notify()` — see item 11 below) via two self-registering hooks so `core/` never imports a Tier-4 app. PR B open (#64): announcements and formal notices with a publish-approval gate, both fanning out through the real `notify()`. PR C (threads/emergency broadcast) not yet started. Plan: `docs/superpowers/plans/2026-09-08-communication-module.md`. parent-portal not started (depends on communication, examinations, fees-finance, attendance — all now done) |
| 5–7 | website-cms, platform-admin, admissions, hr-leave, library, transport, inventory-assets, certificates-documents, reporting-analytics | Not started |

## Per-module implementation matrix

| Module | API | Dashboard screens | E2E | Spec doc |
| ------ | --- | ------------------ | --- | -------- |
| school-organization | done (+ the `/holiday-calendar` calendar §16 declared and nothing had built — `attendance` marks against it) | — (platform-admin/setup UI not built) | live-lane API journeys only (no dashboard UI to drive) — CRUD + tenant isolation for all 9 resources, plus the academic-session `:activate`/`:close`/`:clone` lifecycle | done |
| student-management | done (CRUD, guardians/documents/files, enrollment lifecycle/transfers, import/export/ID cards); **in progress** — `emergency_contacts`/`guardians`/`student_guardians`/`transfers` split into their own resource packages (matching the file-per-action-layout convention already applied to staff-management/timetable/academics/school-organization/communication), but the old flat files (`serializers.py`, `filters.py`, etc.) and `apps.py`/`urls.py` wiring haven't been updated to point at them yet — the new packages exist unused alongside the old ones; `transfers/tests/` also has no test file of its own yet, unlike its three sibling packages (the old `student_management/tests/test_enrollment_transfers.py` still covers the still-wired code path) | was done (list/detail/create/edit + Guardians/Emergency contacts/Documents/History tabs, enroll/change-section/withdraw + transfer dialogs, import wizard, ID-card batch action) — **removed** by the `apps/dashboard` shell reset, rebuilt in a later chunk (`docs/metronic-dashboard-shell.md`) | — | done |
| staff-management | done (CRUD, designations, qualifications/documents with verification, invite/exit, import/export) | was done (list/detail/create/edit + Qualifications/Documents tabs, import wizard) — **removed** by the `apps/dashboard` shell reset, rebuilt in a later chunk (`docs/metronic-dashboard-shell.md`) | — | done |
| academics | done (curriculum CRUD + `:clone`, teacher allocation + load summary, the promotion batch state machine with segregation of duties and idempotent execution) | — (never built) | live-lane API journeys + one promotion browser CUJ | done |
| timetable | done (rooms/periods CRUD, draft slot grid with `meta.conflicts` on every edit, `:validate` / `:publish` with supersede-by-end-dating, `GET /timetables/my` for teacher/student/guardian, substitutions + `:approve`/`:reject`) | was done (week grid editor, conflict panel, publish action, My timetable, substitutions queue) — **removed** by the `apps/dashboard` shell reset, rebuilt in a later chunk (`docs/metronic-dashboard-shell.md`) | live-lane API journeys + one build-and-publish browser CUJ | done |
| fees-finance | **done** (PR A: the per-tenant chart of accounts, the append-only double-entry ledger with its single posting path and reversal-only corrections, and fee heads/structures/installment schedules with a draft→active→archived lifecycle. PR B: bulk invoice generation as a 202 + job with gapless numbering and a duplicate guard that makes a re-run skip rather than double-bill, proration on mid-term enrollment, discounts/scholarships/fines with attributable grants and waivers, cancellation that returns billed fines to the queue, and the nightly due/overdue sweep. PR C: payments whose receipt and ledger posting commit in the same transaction as the money, §7.3's refund workflow with the requester barred from approving, bank/wallet vouchers in A4 and 80mm thermal, and the settlement import with its at-most-once match key and exceptions queue. PR D: expenses under an approval gate that posts to the ledger on approval rather than payment, budgets whose variance is computed from posted entries so a rejected expense stops counting, and §13's eight reports behind one endpoint that serves inline under 1000 rows and hands back a job past it. Follow-up: two campus-scoped budgets on the same account and period now keep their own actual spend, attributed through the `Expense` each posting names — closing a gap the PR D review left open, since `ledger_entries` itself still carries no campus column) | — (backend-only; the dashboard agent owns screens) | — (arrives with the collection journey) | done (module doc §1-§20 + all 22 entities at column level; payroll deferred with hr-leave)
| communication | **in flight** — PR A merged (#62): `NotificationTemplateOverride` (tenant per-code/channel/locale wording, validated against the platform template's declared variable set) and `NotificationPreference` (per-user category × channel opt-in; emergency category refused closed). Extends `core/notifications`'s `notify()` to render each channel's own template (previously every channel reused the single in-app-rendered string) and to gate delivery through a batch-shaped preference resolver — both hooks self-registered from this app's `AppConfig.ready()` so `core/` still never imports a Tier-4 app; both also gated on the `module.communication` feature flag, so a tenant that hasn't enabled the module pays a cached flag check instead of a table query on every `notify()` call platform-wide. PR B open (#64): `Announcement` (draft/scheduled/published/archived) and `Notice` (draft/pending_approval/published/archived, sequence-numbered at publish via `numbering.py`, optional acknowledgment tracked on the recipient's own `Notification.acknowledged_at` row) — both fan out through the real `notify()`. `services.resolve_audience` turns `(audience_type, audience_filter)` into recipient user ids in one query per branch (`all`/`staff`/`students`/`guardians`/`class`/`section`/`custom`); `class`/`section` resolve to the **guardians** of enrolled students, not the students themselves, matching the module doc's own worked example. `publish_notice` enforces the approver ≠ drafter segregation of duties, mirroring fees_finance's refund-approval gate. Threads and emergency broadcast (PR C) not yet started | — (backend-only; the dashboard agent owns screens) | — | plan only (`docs/superpowers/plans/2026-09-08-communication-module.md`); module doc and entity doc pre-date this session and are unchanged
| attendance | **done** (register `:bulk-mark` with idempotent re-submission, the §5.5 lock window, corrections, guardian alerts, nightly lock sweep; the five leave tables, §7.2's escalating chain, auto-marking `on_leave`; staff attendance with `:check-out`, §13's six reports with a 202 export lane, and the absent-teacher cover feed into timetable) | — (backend-only; the dashboard agent owns screens) | live-lane API journeys for marking (mark → re-submit → read back, rejected row, future date) leave (submit → approve → auto-mark, self-approval refused, cancel, overlap) and staff/reports (record a day, check out, run a report, export as a job) | done |
| examinations | **done** (PR A: grading scales with validated bands, exams, per-class subject configuration. PR B: sittings with a date/time clash engine, schedule publish, the idempotent admit-card batch and its PDF job. PR C: the marks grid with its four entry gates, the lock/unlock lifecycle, the sheet import and §6's missing-entries dashboard. PR D: result processing, the approval gate with segregation of duties, publishing, per-student withholding, and versioned report cards with an attendance snapshot. PR E: §13's five reports with a 202 export lane, question banks with §7.2's approval gate, and deterministic paper assembly) | — (backend-only; the dashboard agent owns screens) | — (the live lane still wants a process → approve → publish journey; noted as the module's one remaining gap) | done |
| everything else (12 modules) | — | — | — | done (spec exists; nothing implemented) |

---

## Done

The monorepo skeleton is in place and structurally complete.

| Area | State |
| ---- | ----- |
| Workspace root | pnpm workspace, Turborepo (`dev/build/lint/test/test:coverage/typecheck/clean`), `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`), `.npmrc`, `.nvmrc` (Node 24), `.env.example`, `.gitignore`, committed `pnpm-lock.yaml` |
| CI | `.github/workflows/frontend.yml` — install → API-schema-freshness check → lint → typecheck → test, then an isolated `Test (coverage)` job enforcing an **85% global `coverageThreshold`** per app (`pnpm test:coverage`, see [`07-quality/testing-strategy.md`](07-quality/testing-strategy.md) §9.6 — the floor is a ratchet, never decreases), a build matrix over `dashboard`/`website`, a Playwright E2E job, and a gitleaks secret scan. `.github/workflows/api.yml` — ruff, mypy, tests on real PostgreSQL 18 with coverage, OpenAPI staleness gate, `manage.py check --deploy`. `.github/workflows/repo-hygiene.yml` runs on every PR regardless of path (workflow-YAML validation, markdown-link check, cspell, Prettier, the doc-sync gate below, and the plan-review gate tests and review-record check from ADR-0015) |
| `apps/api` | Django 6.1 + DRF 3.18, managed by `uv`. `core/tenancy` (Tenant/TenantSettings, RLS via `SET LOCAL` + `rls_operations`), `core/rbac` (User/Role/Permission, code-defined permission registry seeded via `post_migrate`), `core/audit` (append-only audit log), `core/api` (envelope renderer, pagination, exception handling, base viewsets). One Django app: `apps/school_organization` (campuses, departments, academic sessions, terms, classes, sections, subjects, houses) — the reference module every later app copies |
| `packages/types` | API envelope `{data, meta}` / `{error:{code,message,details,request_id}}`, cursor + offset pagination, discriminated by `isCursorPagination()`/`isOffsetPagination()`. Fifteen bounded admin lists page by NUMBER (`PageNumberPagination` — students, staff, designations, campuses, departments, classes, sections, subjects, houses, rooms, periods, substitutions, class-subjects, allocations, promotions; the set is named in `api-architecture.md` §2.4), so their `total_count` is always present. Append-heavy lists keep cursors, where `total_count` stays opt-in and is omitted rather than nulled, job resource, auth/RBAC types (`PermissionKey = module.resource.action`), tenant + branding, website CMS content types |
| `packages/api-client` | Hand-written transport core: envelope unwrapping, bearer auth, single-flight refresh-on-401 + replay, `ApiError` normalization, cursor pagination helpers. The resource layer (`schema.d.ts`) is REGENERATED from `apps/api/openapi.yaml` and CI fails if it's stale |
| `packages/ui` | Every primitive except `Sidebar` (button, card, data-table, tabs, sheet, label, tooltip, alert, avatar, dialog, badge, table, separator, dropdown-menu, select, textarea, input, skeleton, form, and `chart` over Recharts, plus accordion/breadcrumb/calendar/collapsible/hover-card/kbd/progress/radio-group/scroll-area/switch/toggle) is now **Metronic's own admin-template component**, ported verbatim rather than adapted — not a from-scratch shadcn port. A handful of props Metronic's components have no equivalent for are restored as additive, opt-in props alongside Metronic's own API: `Button.isLoading`/`loadingLabel`/`block`, `Dialog`/`Sheet.closeLabel`, `Popover.label`, `Checkbox.label`, `Form`'s required-field asterisk, `Table.frame`, and `Card`'s `elevation` (flat/raised/floating)/`tone` (surface/spotlight). `chart.tsx` needed a type-only patch too: Metronic's file assumes recharts@2's Tooltip/Legend prop shapes and this repo runs recharts@3, so the payload typing is hand-rolled rather than imported from Recharts. Badge's tinted appearance is now named `light` (was `soft`). Metronic's own `layouts/`, `partials/`, `image-input/` and `keenicons/` reference directories — vendored alongside the primitives, excluded from typecheck/lint/spellcheck, never wired into anything — were deleted once confirmed unused by either app (the dashboard shell's own port of the relevant pieces, `apps/dashboard/src/app/(app)/shell/`, renamed from `_metronic/`, no longer needed the source alongside it). `Sidebar`/`Header`/`Shell` themselves stay in `apps/dashboard` (they call this app's real session/permissions/preferences directly, so a package shared with the session-less `apps/website` can't hold them) and use Metronic's own `useSettings`/`document.body`-class collapse state verbatim, not a schoolhub-authored state machine — there is no `SidebarCollapseToggle`. Genuinely reusable, zero-app-coupling pieces the shell needed were promoted here instead: `useMenu` (+ generic `MenuItem`/`MenuConfig` types), `useScrollPosition`, `AvatarGroup`, `Rating`, `toAbsoluteUrl`, `DropdownMenu4`, and `useIsMobile` (already existed here, unexported — `apps/dashboard` had silently duplicated it). A port-and-adapted `AccordionMenu` primitive (Radix Accordion-based nested menu, adapted from Metronic's `accordion-menu.tsx` with two ARIA/navigation fixes) is what `apps/dashboard`'s nav rendering is built on; the shell's mega-menu (duplicated the sidebar's real nav with more of Metronic's demo content) was removed rather than promoted. The dashboard shell built on top of these — header, sidebar chrome, nav content — is tracked separately in `docs/metronic-dashboard-shell.md`, not here. `ChartConfig.color` is still TYPED to `var(--sh-color-chart-N)` so a literal colour is a compile error rather than a review note. `empty-state`, `stat-card` (with an `unavailable` state, so a metric whose module does not exist yet says so rather than rendering an error), and shape-matched `skeletons` (screen header / table / grid / chart / detail / form) are schoolhub's own, unaffected by the swap. `DataTable` is a table LAYER rather than a table: it draws one card holding a `toolbar` slot (the screen's filter row plus a show/hide-columns menu), the table itself, the empty state and a footer carrying rows-per-page, the `{from}–{to} of {count}` summary and a numbered pager. Columns declare `sortKey` (server-side ordering only — a header sorts exactly when the endpoint allows it), `numeric` (`measure` end-aligned, `identifier` start-aligned, both in the figures face), `alwaysVisible`, and a per-column `skeleton`. `Checkbox` (indeterminate state), `Pagination` + `getPageNumbers`, `DataTableColumnsMenu`, `BadgeDot`. `--sh-*` Tailwind v4 token layer; default platform brand is **Aurora** (vivid indigo + cyan, with a `chrome` tier for the sidebar/header that is never tenant-overridable but is aliased 1:1 to the page's own background/foreground/muted/border/primary tokens — a flat, same-surface-as-the-page frame separated only by a border, matching Metronic's own admin-template look, confirmed against Metronic's real unmodified Demo1 source before that reference copy was deleted as unused (see above); an earlier recessed/ink-frame chrome design was deliberately retired in favour of that match). Only two named presets live under `presets/` now — **tenant** (branding withheld, whatever `theme.css`'s `:root` carries) and **metronic**, the admin template's own default palette (`config.reui.css`'s zinc/blue/red scale), reproduced as shipped rather than redesigned, including one real AA gap on primary-foreground/primary that is documented rather than corrected. The other seven (ink-brass, azure, cobalt, tangerine, soft-pop, brutalist, neon) were deliberately trimmed to keep the product on a single Metronic look while that's the only palette actively being worked on — nothing about them was wrong, and they're recoverable verbatim from git history (`presets.ts`'s own header has the exact re-add steps) whenever multi-theme support returns. Metronic's own `css/` directory is vendored as that preset's untouched reference source. `DESIGN.md` at the repo root is the written source of truth for the platform default. The token layer carries three surface planes (`surface-sunken`/`surface`/`surface-raised`), three brand-tinted elevation steps, an `info` hue, one named gradient (`bg-spotlight`), and a validated six-slot chart ramp — and the `dark` variant answers to both a `.dark` class (the dashboard's toggle) and `prefers-color-scheme` (the website, which has no toggle) |
| `packages/config` | Shared ESLint flat config (ESLint 9, typescript-eslint) |
| `apps/dashboard` | Auth-guard proxy, tenant-subdomain login (own subdomain namespace, auth cookies via a same-origin proxy), in-memory access token + refresh, TanStack Query client + key factory, `hasPermission`/`<Can>` helpers, `(auth)/login` (RHF + Zod), `/api/health`, next-intl (`en` + `ur`, RTL), a light/dark/match-system toggle (`next-themes`, `attribute="class"`) whose resolved theme the toaster follows, layout preferences (sidebar variant/collapse/state, content width, navbar style, colour preset) persisted via cookie, and `motion` behind `LazyMotion`+`m`. Every business route (students, staff, academics, timetable, admissions...) and the previous `(app)` shell/nav plus the shared `ScreenHeader`/`ApiErrorAlert`/`FilterBar`/`PersonCell`/`useTableParams` list-screen convention were reset to rebuild the shell clean against Metronic's Demo1 template — see `docs/metronic-dashboard-shell.md` for that rebuild's status and backlog. Currently in place: a minimal `(app)` shell — now `apps/dashboard/src/app/(app)/shell/` (renamed from `_metronic/`: this is the app's own composition root, not vendored reference code), with the mega-menu removed (it duplicated the sidebar's real nav with more of Metronic's demo content) and the zero-app-coupling pieces it needed (`useMenu`, `useScrollPosition`, `useIsMobile`, etc.) promoted to `packages/ui` — Metronic-shaped header + sidebar, breadcrumb, ⌘K command palette, permission-unfiltered nav, no session/tenant wiring yet, and one bare placeholder `/dashboard` route so the shell has somewhere to render; tenant theming, session/permission-filtered nav, and every business route are rebuilt in later chunks |
| `apps/website` | Host→tenant proxy, cached tenant resolution, read-only content layer, ISR rendering of `website_pages`/`page_sections`, theme registry + 12 section components, per-tenant sitemap/robots, HMAC-signed revalidate webhook. `lib/host.ts` is the single canonical source for reserved-subdomain labels — `lib/env.ts` re-exports the same Set rather than keeping its own separately-maintained copy |
| `e2e` | Playwright suite with `dashboard` and `website` projects run in the PR gate against mocked routes. `live` (real compose stack, seeded by `manage.py seed_e2e_data`) is opt-in via `.github/workflows/e2e-live.yml` (`workflow_dispatch` + nightly, not the PR gate) — real-browser journeys for login/logout/session/dashboard-summary/tenant-resolution, plus API-only journeys for every `school_organization` resource (no dashboard UI exists for that module yet). `AuthEndpointThrottle` allows only 10 requests/minute, and refresh tokens rotate, so a shared browser session can safely serve at most one cold-navigation test — every live browser spec logs in for itself instead (`e2e/AGENTS.md` has the confirmed reasoning); the `live-setup` project stays wired up for a future spec that's actually safe to share, but nothing uses it today. Live API specs (`tests/live/api/`) share one real login per worker via a worker-scoped fixture instead, which has no rotation problem. `student-management`'s first two Critical User Journeys now have real coverage too: `students-admission-enrollment.spec.ts` (real browser, a minimally-privileged seeded `school_admin` identity — not the all-permissions `school_owner` — walks create student → link guardian → add emergency contact → enroll, plus the real duplicate-admission rejection) and `api/students-record-scope.spec.ts` (a seeded `student`-role identity, `RecordScope.OWN`, proves it sees only its own `Student` row and gets 404 — never 403 — on another's) |
| `infra` | Local dev stack (Docker: Postgres/Redis/MinIO/PgBouncer/Mailpit) |

Both apps (`dashboard`, `website`) were generated with `create-next-app` (Next 16,
Turbopack, Tailwind 4, `src/`, `@/*`) and then customized. The Next-managed block at
the top of each app's `AGENTS.md` is regenerated by `next dev` — removing it from a
diff only re-creates the uncommitted change, so commit it with your work instead.

### Doc-sync gate

`repo-hygiene.yml`'s `project-status-sync` job enforces this file's own rule: any
PR that touches `apps/**`, `packages/**`, `e2e/**`, or `infra/**` must also touch this file
or [`deferred-work.md`](deferred-work.md), or the check fails. Add `[skip-status-doc]` to the PR title for a change that
genuinely doesn't shift the status below (a dependency patch bump, a typo fix).

---

## Repository settings

- Merge, squash and rebase merges are all **allowed** by GitHub's settings; PRs land as merge
  commits by convention ([ADR-0006](decisions/0006-merge-commits.md)). Head branches are **not**
  auto-deleted on merge.
- **Classic branch protection is active on `main`** (verified with
  `gh api repos/{owner}/{repo}/branches/main/protection`): a pull request is required
  (0 approvals), six checks are required and strict — the original `repo-hygiene` jobs (Prettier,
  Markdown links, Secret scan, cspell, Workflow YAML, project-status sync; the plan-review and
  commit-message jobs added later are not yet required) — admins are included, and
  force-push and deletion are blocked. Linear history is **off**, so merge commits land
  ([ADR-0006](decisions/0006-merge-commits.md)). The `api` and `frontend` jobs are **not**
  required checks (they are path-filtered, so requiring them would block PRs that never trigger
  them) — "green before merge" for backend and frontend is still discipline.
- [`.github/rulesets/main.json`](../.github/rulesets/main.json) is **not applied** (no rulesets
  exist). It now matches ADR-0006 (merge commits only, no linear-history rule) and requires the
  always-running `repo-hygiene` checks, so applying it would add, not remove, protection.

## Deliberately NOT done

Moved to [`deferred-work.md`](deferred-work.md) — every deferred item, cut scope and known gap,
with its reasoning. Read the entry for the area you are about to touch before re-deciding it.

---

## Start here next session

0. **Make the new checks blocking** (owner, once the engineering-standards stack #82–#86 has
   merged): add `Plan-review gate tests`, `Specs and plans carry an independent review` and
   `Commit messages follow the convention` to `main`'s required status checks —
   `gh api -X POST repos/{owner}/{repo}/branches/main/protection/required_status_checks/contexts -f 'contexts[]=Plan-review gate tests' -f 'contexts[]=Specs and plans carry an independent review' -f 'contexts[]=Commit messages follow the convention'`.
   Until then they report but don't block (ADR-0015, ADR-0016).
1. **CI is the source of truth for coverage** — the 85% `Test (coverage)` floor is a
   ratchet (never decreases), so a new PR without its own tests fails this check —
   expected, not a gate bug. Check the latest `frontend.yml` run for the current
   per-app percentages rather than trusting a number written here, since it drifts
   with every PR.
2. **Leave the two-TypeScript setup alone.** `typescript` is aliased to the TS 6 API for
   tooling and `@typescript/native` supplies TS 7's `tsc`. Collapse to one
   TypeScript only after typescript-eslint supports the 7.1 API (#10940).
3. **Do not bump ESLint to 10.** `eslint-plugin-react` (bundled in `eslint-config-next`)
   still calls `context.getFilename()`, which ESLint 10 removes.
4. **Decide the typed-routes question.** App code uses explicit prop types rather than Next 16's
   generated `PageProps`/`LayoutProps` globals. If the team prefers the generated
   globals, add `next typegen` to the `typecheck` script.
5. **`student-management` full-stack is complete**, landed as 4 sequenced,
   stacked PRs: PR 1 foundation + student CRUD, PR 2 guardians/documents/
   files, PR 3 enrollment lifecycle/transfers, PR 4 import/export + ID
   cards. Along the way it built genuinely reusable platform infrastructure
   every later module inherits: `core.tenancy.features` (feature flags),
   `core.tenancy.sequences` (gapless per-tenant counters),
   `core.tenancy.tasks.TenantAwareTask` (tenant-bound Celery base class),
   `core.files` (two-step upload + server-generated `create_ready_file()`),
   `core.idempotency` (`Idempotency-Key` replay), and `core.jobs`
   (`BackgroundJob` + `GET /jobs/{id}`).
6. **`staff-management` full-stack is complete** (one PR, not stacked —
   the module is small enough that the students-style multi-PR split wasn't
   needed), reusing every piece of infrastructure from item 5 as-is:
   `core.tenancy.features` (`module.staff` flag), `core.tenancy.sequences.
   allocate_number` (`employee_number`), `core.jobs`/`core.tenancy.tasks.
   TenantAwareTask`/`core.files.create_ready_file()` (import/export jobs).
   **Phase 2 Tier 1 ("People") is now done.**
7. **PR 0 (platform hardening) is done** — three fixes and two new pieces of
   platform infrastructure, all listed above: the upload-purpose registry, the
   guardian record scope, the api-client refresh split, the Celery beat
   schedule, and `core.notifications`. Every Tier 2 module consumes at least
   two of them.
8. **`attendance` is in flight, as three stacked PRs, and PR 1 has landed.**
   The build order `academics → timetable → attendance` held and was
   load-bearing: `timetable` needed `academics`' `teacher_subject_allocations`,
   and attendance's period mode is expressible only because `timetable.Period`
   already exists. Attendance did *not* fit PR #30's single-PR shape — it owns
   eight tables including the whole leave system — so it is split:
   **PR 1 (landed): marking.** The register, the lock window, corrections, the
   guardian alerts, and the school calendar in `school-organization` that §11
   needs and nothing had built.
   **PR 2 (landed): the leave system.** §15's five leave tables, `/leave-requests`
   and its three colon-actions, a read-only `/leave-types`, §7.2's escalating
   chain, and approved leave auto-marking `on_leave`. Both dangling
   `leave_request_id` columns became real FKs. `/leave-types` writes,
   `/leave-policies` and `/leave-balances` did **not** ship — see the gap recorded in
   [`deferred-work.md`](deferred-work.md).
   **PR 3 (landed): staff attendance and reports.** `staff_attendance` +
   `:check-out`, the `attendance_corrections.staff_attendance_id` column and its
   widened CHECK, §13's six reports behind one `kind`-parameterised endpoint with
   a 202 export lane, and the absent-teacher cover feed into `timetable`.
9. **The table layer is done; three things are deliberately left for a later pass.**
   Every list screen is `useTableParams` + `DataTable`, every column backed by a
   real field is sortable, and the endpoints were widened to match — including
   `StableOrderingFilter`, which appends a unique tiebreaker so a cursor page
   boundary can no longer land mid-tie and silently skip or repeat rows. Not
   done, and each its own piece of work:
   - **Row actions.** No table has a trailing `…` menu; rows navigate on click.
     The reference kits put edit/delete/duplicate there, which needs a per-screen
     action inventory and a permission key each.
   - **Responsive default column visibility.** Hidden columns live in the URL, so
     a breakpoint-driven default has to decide what beats what — a reader's
     explicit choice must survive a resize.
   - **`const EMPTY = "—"` is declared in eleven files.** It belongs in
     `lib/format.ts`; the sweep touches eleven screens and was not worth folding
     into this work.
10. **Two entity-ownership conflicts to settle before the modules that hit them.**
   Both module docs claim the same tables, and only one app can ship the
   migration:
   - ~~`attendance` §15 and `hr-leave` §15 both claim `leave_types`,
     `leave_policies`, `leave_balances`, `leave_requests`, `leave_approvals`.~~
     **Settled and recorded** in both `03-modules/attendance.md` §15 and
     `03-modules/hr-leave.md` §15 when attendance PR 2 shipped those tables:
     attendance owns them, hr-leave adds none.
   - ~~`communication` §15 and `core/notifications` both cover `notifications`
     and `delivery_logs`.~~ **Settled and recorded** — `entities/communication.md`'s
     `notifications` section states the split explicitly: those two tables, the
     adapters, the platform default templates and `notify()` are `core/notifications/`'s;
     `communication` owns `notification_templates` (tenant overrides),
     `notification_preferences`, announcements/notices/threads and the delivery
     dashboard. `communication` PR A (in flight, item 11 below) is the first PR to
     actually build against that split.
11. **`communication` (Tier 4) is in flight, as three stacked PRs; PR A is merged (#62), PR B is open (#64).**
   Plan: `docs/superpowers/plans/2026-09-08-communication-module.md`. PR A extended
   `core/notifications` — which already owns `notifications`/`delivery_logs`,
   `notify()` and the platform-default template registry (item 10's second bullet)
   — with two hooks `communication` registers at `AppConfig.ready()`:
   `core.notifications.templates.set_override_resolver()` (tenant-editable,
   per-channel rendering; previously every channel reused the single
   in-app-rendered string, which is why `DeliveryLog` gained its own `subject`/
   `body` columns) and `core.notifications.services.set_preference_resolver()`
   (per-user channel opt-out, with the mandatory in-app channel and every
   `emergency`-category trigger exempt by construction, and **batch-shaped** —
   `(user_ids, category, channel, tenant_id) -> {user_id: bool}`, one resolver
   call per gated channel per `notify()` call rather than one per recipient,
   after a review caught the per-item version reintroducing the exact
   per-recipient round trip `resolve_addresses` already avoids for email).
   Both hooks are also gated on the `module.communication` feature flag now,
   so a tenant that hasn't enabled the module pays a cached flag check instead
   of a table query on every `notify()` call platform-wide, regardless of which
   module fired the trigger. With neither hook registered — the state before
   this module shipped, and every test that doesn't explicitly register one —
   behaviour is byte-identical to before; regression-tested against the three
   existing `notify()` callers (attendance, fees_finance, examinations).
   `NotificationTemplateOverride`/`NotificationPreference` (PR A) and
   `Announcement`/`Notice` (PR B) models, services, endpoints and RLS policies
   are in. PR B's `services.resolve_audience` turns `(audience_type,
   audience_filter)` into recipient user ids, one query per branch
   (`all`/`staff`/`students`/`guardians`/`class`/`section`/`custom`) —
   `class`/`section` resolve to the **guardians** of enrolled students, not the
   students themselves, matching the module doc's own worked example ("targets
   classes 6-10 guardians"). `publish_notice` enforces the approver ≠ drafter
   segregation of duties (auth-and-rbac §2.4), mirroring fees_finance's
   refund-approval gate, and allocates a gapless `notice_no` through
   `numbering.py` (copies fees_finance/numbering.py's blank-the-`{seq}`-token
   pattern). PR C (message threads + emergency broadcast) has not started.
   Scope decisions recorded in the plan's Context section: locale variants
   deferred (no `User.locale` field yet — only `en` templates are created),
   SMS/push/WhatsApp providers deferred (no `core/integrations`, same
   reasoning as fees-finance's payment gateway), `GET /announcements`/
   `GET /notices` staff-only (guardians consume via the existing
   `GET /notifications` inbox; a guardian-facing browse endpoint is recorded
   as parent-portal's task), notice acknowledgment-progress reporting deferred
   (tracked per-recipient on `Notification.acknowledged_at`, but no aggregate
   endpoint yet).

## Conventions worth re-reading before writing code

- Components resolve colour through `--sh-*` custom properties only — no literal hex, no
  `blue-600`. Tenant branding is the only thing that may override a `--sh-color-*`/
  `--sh-font-*`/`--sh-radius` value at runtime; the default is SchoolHub's own
  "Aurora" platform brand — see `DESIGN.md` at the repo root, and the doc comment at the
  top of `packages/ui/src/styles/theme.css`. A `--sh-platform-*` tier is separate and
  never tenant-overridable at all, and so is the `--sh-color-chrome-*` tier that skins
  the sidebar and header.
- Chart colour comes from `--sh-color-chart-1..6` in fixed slot order, never cycled and
  never by rank. Bars/lines/stacks may use all six; scatter, bubble and small-multiples
  are capped at the first three (slot 4 collapses against slot 2 under protanopia). Status
  is never carried by a chart colour — it takes success/warning/danger with an icon and a
  label. The reasoning and the measured separations are in `theme.css`'s own header.
- `bg-spotlight` is allowed **once per screen**, on that screen's hero element. It is a
  named utility rather than an inline gradient specifically so a second use is greppable.
- A column sorts only if the endpoint declares the field in `ordering_fields`. The UI
  never sorts the rows it holds: one page of 25 out of 400 students reordered in the
  browser looks like a sort and is a lie. Relation sorts are `annotate()`d and ordered by
  the alias, never `campus__name` — `SELECT DISTINCT` plus an `ORDER BY` on a joined
  column is a 500 for any principal whose `scope_queryset` adds `.distinct()`.
- Permission-aware UI is UX, never enforcement — the API enforces.
- `apps/website` must never gain a write path.
- Every new env var goes into `.env.example` with a dummy value and a comment.
- Tenant isolation is enforced by PostgreSQL RLS; every tenant-owned table
  inherits `TenantOwnedModel` and gets a policy via `core.tenancy.rls.rls_operations`
  in a hand-written `0002_rls_policies.py`. Cross-tenant access returns 404, never 403.
- Every backend endpoint declares a `module.resource.action` permission key
  (`docs/02-architecture/auth-and-rbac.md` §2.1); the permission class fails closed.
- The API contract is generated, not hand-written — `apps/api/openapi.yaml` and
  `packages/api-client/src/schema.d.ts` change together, in one commit.
- Every TS package/app tests in a sibling `__tests__/` folder next to the source it
  covers, not `*.test.ts(x)` co-located flat beside it — `packages/ui`, `apps/dashboard`,
  `apps/website`, and `packages/api-client` all moved to this convention; new test files
  go straight into `__tests__/` rather than being co-located and moved later.
