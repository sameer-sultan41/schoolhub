# Phase 1 — Design (UI/UX, Architecture, Database, API Contracts)

> **Agent Context**
> **Summary:** Covers lifecycle activities 3–5 (UI/UX design, system architecture & technical design, database architecture & design). Produces UX flows → wireframes → hi-fi screens, the design system, finalized system architecture, a frozen ERD for core modules, and an OpenAPI-first contract skeleton — all gated by formal design reviews before Phase 2 writes code. Duration (~5 weeks) is a **recommendation**.
> **Co-load with:** [`phase-plan.md`](phase-plan.md) · [`../02-architecture/tech-stack.md`](../02-architecture/tech-stack.md) · [`../02-architecture/api-architecture.md`](../02-architecture/api-architecture.md) · [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md)

## Objective

Design before code: turn the signed SRD into build-ready artifacts — user flows and high-fidelity screens for the core modules, a finalized system and database architecture, and versioned API contracts — so that Phase 2 teams implement against reviewed designs rather than inventing them mid-sprint.

## Entry Criteria

- Phase 0 exit criteria met: signed SRD, MoSCoW backlog, pilot schools contracted, stack confirmed.
- Design tooling and shared workspace set up (Figma or equivalent; diagram source in the repo).
- Core team staffed (recommendation: 1 UX/UI designer full-time, 1 architect/tech lead, 1 backend engineer, 1 frontend engineer, BA continuing part-time).

## Activities

### 1. UI/UX design

Runs as a pipeline per persona journey, ordered by the Phase 2 build sequence so early-build modules are designed first:

1. **User flows** — task-level flows for each core journey (mark attendance, run a fee cycle, enter and publish results, onboard a school via the wizard, parent pays a fee). Flows reference role slugs from [`../00-overview/users-and-roles.md`](../00-overview/users-and-roles.md) only.
2. **Low-fi wireframes** — screen inventory and navigation model for the dashboard (module-per-nav-section) and the public website theme v1 ([`../03-modules/website-cms.md`](../03-modules/website-cms.md)).
3. **Design system** — tokens (color, type, spacing, radius) built for **per-tenant theming** from day one (tenant logo/colors per [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §5); component library on Tailwind + shadcn/ui per [`tech-stack.md`](../02-architecture/tech-stack.md); empty/loading/error states standardized.
4. **High-fidelity screens** — hi-fi for every Must-have module screen; representative screens only for Should/Could features.
5. **Accessibility** — WCAG 2.1 AA target (recommendation): contrast-checked tokens, full keyboard operability of forms/tables, focus states in the component library, RTL readiness for Urdu (`next-intl` locales). Acceptance criteria recorded in `../07-quality/non-functional.md`.
6. **Validation** — clickable prototype walkthroughs with one pilot school per persona (teacher, accountant, parent); findings triaged into the designs before freeze.

### 2. System architecture finalization

- Finalize the component architecture: dashboard app, website renderer, backend API, Celery workers, Redis, Postgres, object storage, AI gateway — with communication paths and authentication between each (feeds `repo-structure.md` and hosting docs).
- Lock the cross-cutting decisions already recommended: REST + OpenAPI 3.1 ([`api-architecture.md`](../02-architecture/api-architecture.md)), shared-schema RLS tenancy ([`multi-tenancy.md`](../02-architecture/multi-tenancy.md)), JWT auth ([`auth-and-rbac.md`](../02-architecture/auth-and-rbac.md)).
- **Mobile-readiness check** (phase-plan §4 rule 4): no cookie-only auth flows, no HTML-only responses on API paths a future mobile app would need.
- Threat-model workshop on the architecture (tenant isolation, file uploads, webhooks) with outcomes recorded in [`../06-security/security.md`](../06-security/security.md).

### 3. Database design (ERD freeze for core modules)

- Entity modeling per module doc (§ Database Entities), consolidated into the platform ERD in `../05-database/`.
- Every tenant-owned table carries `tenant_id`, audit fields, and the soft-delete strategy; RLS policies drafted alongside the tables, not after.
- Naming conventions, index strategy for known heavy reads (attendance by date, fee-invoice status scans, result aggregation), and migration strategy documented in `../05-database/database-architecture.md`.
- **Freeze scope:** the ERD is frozen for **core modules** (the foundation through fees/communication tiers of the Phase 2 graph). Later-tier modules (library, transport, inventory) get reviewed drafts, freezable at their Phase 2 build slot. Post-freeze changes require an ADR + architect approval.

### 4. API contract skeleton (OpenAPI-first)

- Author OpenAPI 3.1 skeletons per core module **before implementation**: resources, verbs, colon-actions, error envelope, pagination and filter parameters — all conforming to [`api-architecture.md`](../02-architecture/api-architecture.md) §2/§4.
- Generate TypeScript types from the skeletons so frontend work in Phase 2 starts against mocked contracts.
- Contract review checks each endpoint's permission key (`module.resource.action`) exists in the RBAC catalog ([`auth-and-rbac.md`](../02-architecture/auth-and-rbac.md)).

### 5. Design review gates

| Gate | Reviews | Reviewers | Blocks |
| ---- | ------- | --------- | ------ |
| **G1 — UX review** | Flows + wireframes per module batch | BA, pilot-school champion, tech lead | Hi-fi work on that batch |
| **G2 — Architecture review** | System architecture, threat model, tenancy enforcement | Tech lead + external senior reviewer (recommendation) | Any Phase 2 code |
| **G3 — ERD freeze review** | Core-module ERD, RLS policies, index plan | Backend engineers + architect | Phase 2 migrations |
| **G4 — Contract review** | OpenAPI skeletons per module | Backend + frontend leads | Frontend build of that module |

## Deliverables

- UX flow diagrams, wireframes, and hi-fi screens for all Must-have modules; clickable prototype.
- Design system: token set, themed component library, accessibility annotations.
- Finalized architecture document set (`../02-architecture/`), threat model, ADR log started.
- Frozen core-module ERD + drafted RLS policies (`../05-database/`).
- OpenAPI 3.1 contract skeletons + generated TS types for core modules.
- Signed-off review records for gates G1–G4.

## Roles Involved

- **UX/UI designer** (lead, Activities 1) · **Architect/tech lead** (lead, Activities 2, gates) · **Backend engineer** (Activities 3–4) · **Frontend engineer** (Activity 4 consumer, design-system feasibility) · **BA** (traceability SRD ↔ designs) · **Pilot-school champions** (prototype validation) · **Client sponsor** (G1 visibility, final acceptance).

## Exit Criteria

Matches [`phase-plan.md`](phase-plan.md) §3: **architecture review passed; ERD frozen for core modules**, specifically:

1. Gates G1–G4 passed for every foundation- and core-tier module in the Phase 2 graph.
2. Design system published and consumable as code (component package builds in the monorepo).
3. OpenAPI skeletons merged; TS type generation wired into CI.
4. Threat model actions either resolved or scheduled with owners.
5. Prototype validation completed with at least one pilot school per key persona.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Hi-fi perfectionism delays the freeze | Phase 2 start slips | Hi-fi only for Must-haves; Should/Could ship with wireframe + design-system composition |
| ERD frozen too early on weakly-understood modules (fees, exams) | Costly migration churn in Phase 2 | Extra BA validation pass on fees/examinations entities against collected artifacts before G3 |
| Contract-first drifts from implementation reality | Frontend built against dead contracts | drf-spectacular generation diffed against the skeleton in CI from Phase 2 week 1 |
| Per-tenant theming bolted on late | Rework across every component | Theming is a G1 acceptance criterion on the design system itself |
| Accessibility deferred as polish | Expensive retrofits, UAT findings | Contrast and keyboard rules enforced in the component library, not per-screen |
| Review gates become rubber stamps | Defects discovered in Phase 5 instead | Named reviewers with written findings; a gate without findings is re-reviewed |
