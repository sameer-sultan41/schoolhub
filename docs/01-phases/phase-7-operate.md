# Phase 7 — Operate & Scale (Documentation, Training, Support, Maintenance)

> **Agent Context**
> **Summary:** Covers lifecycle activities 17–18 (documentation & training, maintenance & support, future scaling). The steady state after launch: role-based training material, tiered support with SLAs (**recommendations**), a maintenance cadence (dependency updates, backup verification, DR re-drills), a disciplined enhancement intake feeding the roadmap, and the pointer to the future tracks in `../08-future/`. Ongoing; the first ~8 weeks are the stabilization window per [`phase-plan.md`](phase-plan.md).
> **Co-load with:** [`phase-plan.md`](phase-plan.md) · [`phase-6-launch.md`](phase-6-launch.md) · [`../08-future/mobile-apps.md`](../08-future/mobile-apps.md) · [`../08-future/extensibility.md`](../08-future/extensibility.md)

## Objective

Keep the platform reliable, supported, and improving: every user role can learn the system without a developer in the room, incidents and requests flow through defined support tiers with SLAs, the platform stays patched and its backups stay provably restorable, and new demand is captured through an intake process that feeds a deliberate roadmap rather than ad-hoc feature work.

## Entry Criteria

- Phase 6 exit criteria met: pilots live, on-call active, DR drill passed.
- Support tooling selected (helpdesk/ticketing, status page, shared knowledge base).
- Documentation drafts accumulated through Phases 2–5 (phase-plan §1 notes training material is *drafted throughout*, finalized here).
- Success metrics sheet from [`phase-0-discovery.md`](phase-0-discovery.md) loaded into a reviewable dashboard.

## Activities

### 1. Documentation & training

- **Admin manuals** — full-length, per-role handbooks for `school_owner`/`school_admin`/`it_admin`: onboarding wizard, academic-year setup, roles and permissions, fee configuration, imports/exports, integrations, audit logs. Versioned with the product; regenerated screenshots on major releases.
- **Teacher quick-starts** — 2–4-page task cards (mark attendance, enter marks, generate a quiz with AI and review it, message parents). Designed for staff-room printing; localized (English + Urdu) per the platform's locale support.
- **Video walkthroughs** — 3–5-minute task videos per persona, including parent-facing clips (view results, pay fees) that schools can forward on their own channels; hosted so tenants can embed them on their websites.
- **In-product help** — contextual help links from each module screen to the corresponding guide; AI assistant grounded on this documentation set for "how do I…" questions.
- **Train-the-trainer** — each school nominates 1–2 champions who receive live training and become first-line help inside the school; new-tenant onboarding includes a standard training package (recommendation: 2 admin sessions + 1 teacher session).

### 2. Support tiers & SLAs (recommendation — confirm commercially per plan)

| Tier | Who | Handles |
| ---- | --- | ------- |
| L1 | School champion + knowledge base + AI help | How-to, password/access, data-entry questions |
| L2 | Platform support (`platform_support`, audited impersonation) | Configuration, data corrections, integration issues |
| L3 | Engineering on-call | Defects, incidents, security events |

| Severity | Example | Response / Resolution target |
| -------- | ------- | ---------------------------- |
| S1 | Platform or tenant down, data integrity, isolation or payment fault | 30 min / 4 h, 24×7 |
| S2 | Core flow broken (attendance, fees, results), no workaround | 2 business h / 1 business day |
| S3 | Degraded or workaround exists | 1 business day / next maintenance release |
| S4 | Questions, cosmetic issues | 2 business days / backlog |

Status page for S1/S2; monthly SLA compliance reported to the client; post-incident reviews mandatory for S1 (and repeated S2s), with actions tracked to closure.

### 3. Maintenance cadence

| Cadence | Activity |
| ------- | -------- |
| Weekly | Dependency/security patch review (Dependabot triage); alert-noise review; error-budget check against SLOs |
| Bi-weekly | Maintenance release window (patches, S3 fixes, minor enhancements) — communicated, off school hours |
| Monthly | **Backup restore verification** (automated restore + integrity checks — the Phase 6 drill, recurring); slow-query and cost review; AI eval re-run + token-spend review per [`phase-3-ai.md`](phase-3-ai.md) |
| Quarterly | Full DR drill; access/credential review (staff offboarding, key rotation); pen-test delta or re-test on changed surfaces; capacity re-forecast ahead of admission seasons |
| Annually | Framework major-version upgrades planned as roadmap items; academic-year rollover support campaign (promotions, new sessions, fee structures) |

### 4. Enhancement intake

- Single intake funnel: UAT-deferred change requests, support-ticket patterns, champion feedback, in-product feature requests, and sales asks all land in one triaged backlog — nothing goes "straight to a sprint."
- Monthly product council (client sponsor + PM + tech lead): MoSCoW re-scoring, roadmap slotting, and explicit rejection with reasons; requesting schools get a response either way.
- Guardrails: multi-tenant thinking first — a school-specific ask ships as **configuration** (workflow, custom role, template, flag) wherever possible per [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §5; per-tenant code forks are prohibited.
- Success metrics from Phase 0 reviewed at 30/60/90 days post-launch; gaps become prioritized intake items.

### 5. Future roadmap execution

The forward tracks are specified in `../08-future/` and enter delivery through the same intake and phase discipline (a future track gets its own mini phase plan):

- **Mobile applications** — [`../08-future/mobile-apps.md`](../08-future/mobile-apps.md): Flutter apps for parents/students/teachers on the same REST API; the mobile-readiness reviews run at every phase exit exist precisely so this track starts without backend rework.
- **Extensibility** — [`../08-future/extensibility.md`](../08-future/extensibility.md): additional website themes, marketplace/third-party integrations, biometric/RFID attendance, IoT, advanced AI models, additional channels, subscription/billing depth.

## Deliverables

- Published documentation set: admin manuals, teacher quick-starts, parent guides, video library, in-product help.
- Operating support system: helpdesk live, tiers/SLAs in force, status page, PIR template and archive.
- Maintenance calendar with owners; first monthly backup verification and first quarterly DR drill completed on schedule.
- Enhancement intake board + product-council minutes; 90-day success-metrics review.
- Roadmap document referencing the `../08-future/` specs with entry criteria per track.

## Roles Involved

- **Support lead / L2 staff** (tiers, SLAs, knowledge base) · **Technical writer / BA** (manuals, quick-starts) · **Designer/PM** (videos, training delivery) · **DevOps** (maintenance cadence, backup/DR verification) · **Engineering on-call** (L3) · **PM + client sponsor** (product council, roadmap) · **School champions** (L1, feedback channel).

## Exit Criteria

Steady-state phase — no exit ([`phase-plan.md`](phase-plan.md) §3). Health is instead reviewed quarterly against: SLA compliance ≥ target, maintenance calendar adherence (no missed backup verifications or DR drills), Phase 0 success metrics met or improving, intake backlog triaged (no item unanswered > 1 month), and future-track entry criteria tracked.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Documentation rots as the product evolves | Support load grows, training fails | Docs versioned with releases; screenshot regeneration and doc review are release-checklist items |
| Support bypasses tiers ("call the developer") | Engineering capacity drained | Single helpdesk entry point; champions trained; SLA reporting exposes bypass patterns |
| Backup verification skipped once things feel stable | Unrestorable backup discovered during an incident | Automated monthly restore job with alerting on failure; quarterly human-run DR drill |
| Enhancement pressure erodes multi-tenant discipline | Per-school forks, unmaintainable platform | Configuration-first guardrail enforced at product council; forks prohibited by policy |
| Champion turnover at schools | L1 collapses for that tenant | Two champions per school; refresher training each academic year rollover |
| Roadmap tracks started without capacity | Steady-state quality slips | Future tracks require product-council sign-off with staffing plan before entry |
