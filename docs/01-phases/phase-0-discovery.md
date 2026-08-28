# Phase 0 — Discovery (Requirement Gathering & Analysis)

> **Agent Context**
> **Summary:** Covers lifecycle activities 1–2 (requirement gathering & analysis, business & functional analysis). Defines the stakeholder-interview program, pilot-school selection, MoSCoW prioritization, and the deliverables that gate everything downstream: a signed SRD, a prioritized module backlog, and measurable success metrics. Duration (~3 weeks) and team size are **recommendations**, re-baselined at phase exit.
> **Co-load with:** [`phase-plan.md`](phase-plan.md) · [`../00-overview/users-and-roles.md`](../00-overview/users-and-roles.md) · [`phase-1-design.md`](phase-1-design.md)

## Objective

Convert the client's scope statement into a signed, prioritized, testable requirements baseline: confirm what the platform must do, for whom, in which order, and how success will be measured — before any design or code is committed. Phase 0 also selects the pilot schools whose real operations validate every later phase (UAT in [`phase-5-testing.md`](phase-5-testing.md), onboarding in [`phase-6-launch.md`](phase-6-launch.md)).

## Entry Criteria

- Client scope statement received and circulated to the team.
- Project sponsor identified on the client side with authority to sign off scope.
- Access agreed to at least three candidate schools for interviews and process observation.
- Core team availability confirmed (recommendation: 1 product analyst, 1 tech lead, 1 UX designer part-time, project manager).

## Activities

### 1. Requirement gathering

- **Stakeholder interviews**, structured per persona (60–90 min each, recorded and minuted):
  - **School owners** — commercial goals, pricing sensitivity, branding expectations, multi-campus needs, reasons previous systems failed.
  - **Principals / vice principals** — approval workflows (results, leave, certificates), oversight dashboards, academic calendar realities.
  - **Accountants / finance staff** — fee structures, discount/fine/refund practices, ledger and payroll expectations, current reconciliation pain.
  - **Teachers** — daily attendance and marks-entry workload, timetable pain points, appetite for AI lesson/quiz generation.
  - **Parents** — communication channels actually used (SMS/WhatsApp vs. email), fee-payment habits, result and attendance visibility expectations.
- **Process observation:** shadow one full school day at a pilot candidate (morning attendance, a fee-collection window, a notice going out) to capture the workflows the interviews idealize.
- **Artifact collection:** current fee vouchers, report cards, attendance registers, admission forms, certificates — these become the templates the system must reproduce (see [`../03-modules/certificates-documents.md`](../03-modules/certificates-documents.md)).
- **Competitive scan:** document 3–5 incumbent SMS products; identify the gaps the AI differentiation must exploit (feeds [`phase-3-ai.md`](phase-3-ai.md)).

### 2. Business & functional analysis

- Consolidate findings into functional requirements per module, mapped onto the locked module list (`../03-modules/`), and non-functional requirements (`../07-quality/non-functional.md`).
- Classify every requirement as **core platform**, **school-configurable**, or **future** — the three-way split required by the scope (§2).
- Record business rules, assumptions, constraints, and dependencies with named sources ("Principal, School B, interview 4").
- Validate the role model in [`../00-overview/users-and-roles.md`](../00-overview/users-and-roles.md) against real org charts; capture school-specific custom-role needs.

### 3. Pilot-school selection

Select 2–3 pilot schools against explicit criteria: (a) size diversity (one small ≤500 students, one mid/large), (b) at least one multi-campus tenant, (c) willingness to run UAT and go first at launch, (d) an accessible internal champion, (e) existing digital records available for the import tooling in [`phase-4-integrations.md`](phase-4-integrations.md). Sign a lightweight pilot agreement covering data access, feedback commitments, and launch expectations.

### 4. Prioritization (MoSCoW)

- Score every functional requirement **Must / Should / Could / Won't (this release)** in a workshop with the client sponsor; ties are broken by pilot-school operational necessity, then revenue impact.
- Must-haves define the Phase 2 core build order (see the dependency graph in [`phase-2-core-build.md`](phase-2-core-build.md)); Won'ts are recorded — not deleted — in `../08-future/`.
- Confirm the technology recommendations in [`../02-architecture/tech-stack.md`](../02-architecture/tech-stack.md) with the client; any swap happens here or not at all before Phase 1.

### 5. Success metrics definition

Define measurable launch metrics with the client, for example (recommendations): pilot schools run daily attendance, fees, and communication without parallel spreadsheets within 4 weeks of go-live; ≥70% of teachers active weekly; fee-collection reconciliation time reduced ≥50%; ≥1 AI feature used weekly per staff persona. These metrics are re-checked in [`phase-7-operate.md`](phase-7-operate.md).

## Deliverables

| Deliverable | Description |
| ----------- | ----------- |
| **Signed SRD** | This documentation set (overview, phases, architecture, module docs) signed off by the client sponsor |
| **Prioritized module backlog** | Every module's features MoSCoW-tagged, sequenced against the Phase 2 build order |
| **Success metrics sheet** | Quantified go-live and 90-day metrics with data sources |
| Pilot agreements | 2–3 signed pilot-school commitments |
| Interview & observation records | Minutes, artifacts, and traceability from each requirement to its source |
| Stack confirmation | Client acceptance (or substitution) of the [`tech-stack.md`](../02-architecture/tech-stack.md) recommendations |

## Roles Involved

- **Product analyst / BA** (lead) — interviews, requirement consolidation, MoSCoW facilitation.
- **Tech lead / architect** — feasibility screening, stack confirmation, integration constraints.
- **UX designer** (part-time) — joins interviews and observation to seed Phase 1 flows.
- **Project manager** — schedule, sign-off logistics, pilot agreements.
- **Client sponsor + pilot-school stakeholders** — input and sign-off authority.

## Exit Criteria

Matches [`phase-plan.md`](phase-plan.md) §3: **client sign-off on scope and stack recommendations**, specifically:

1. SRD signed by the client sponsor.
2. MoSCoW backlog approved; Must-set fits the Phase 2 capacity estimate (or the plan is re-baselined).
3. 2–3 pilot schools contracted.
4. Success metrics agreed and quantified.
5. No open "blocking" questions in the decision log.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Stakeholders describe idealized rather than real workflows | Wrong requirements baked into the SRD | Pair every interview track with on-site observation; validate rules against collected artifacts |
| Scope inflation during interviews ("can it also…") | Phase 2 overruns | MoSCoW discipline; every new ask is logged and scored, never verbally accepted |
| Client sponsor lacks decision authority | Sign-off stalls, phase drags | Confirm authority at entry; escalate to owner-level sponsor in week 1 if unclear |
| Pilot schools unrepresentative (all small, or all one board/curriculum) | UAT passes but market fit fails | Enforce the size/campus diversity criteria in Activity 3 |
| Interview fatigue compresses parent/teacher input | Persona gaps surface late (Phase 5 UAT) | Cap sessions at 90 min; use short async questionnaires for parents/teachers beyond the core interviewees |
| AI expectations set unrealistically high in discovery | Phase 3 disappointment | Demo concrete AI feature prototypes with limits stated; anchor to the governance rules in [`../04-ai/ai-governance.md`](../04-ai/ai-governance.md) |
