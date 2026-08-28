# Phase 3 — AI Feature Development & Integration

> **Agent Context**
> **Summary:** Covers lifecycle activity 8. Builds the AI gateway first, then ships AI features persona-by-persona (admin, teacher, student, parent), each behind human-approval gates where output reaches records or recipients. Establishes the evaluation harness and per-tenant token budgeting before broad rollout. Runs in parallel with Phase 4 after the core build; ~6 weeks is a **recommendation**.
> **Co-load with:** [`phase-plan.md`](phase-plan.md) · [`../02-architecture/ai-architecture.md`](../02-architecture/ai-architecture.md) · [`../04-ai/ai-features.md`](../04-ai/ai-features.md) · [`../04-ai/ai-governance.md`](../04-ai/ai-governance.md)

## Objective

Deliver the product's differentiator: AI features that produce measurable value per persona — assistants, natural-language search, content generation, and risk analytics — built on a provider-agnostic gateway with governance (human approval, privacy, budgets, evaluation) engineered in from the first feature, not retrofitted.

## Entry Criteria

- Phase 2 exit criteria met; core modules stable on staging with realistic seeded data (AI features consume real module data shapes).
- [`../02-architecture/ai-architecture.md`](../02-architecture/ai-architecture.md) reviewed; provider account, keys, and data-processing terms in place.
- Governance checklist in [`../04-ai/ai-governance.md`](../04-ai/ai-governance.md) approved by the client (approval gates, data-privacy rules, disclosure requirements).
- Feature-level MoSCoW for AI features confirmed from the Phase 0 backlog.

## Activities

### 1. AI gateway build (first, everything depends on it)

A backend-internal service — no browser ever calls a provider directly ([`tech-stack.md`](../02-architecture/tech-stack.md) §6):

- **Provider abstraction:** single internal interface over the primary LLM provider; per-feature model selection and a fallback chain (degrade to a cheaper model or a clear "AI unavailable" state — never silent failure).
- **Tenant context injection:** every call carries `(tenant_id, user_id, feature_key)`; prompts are assembled server-side from RLS-scoped data only — the gateway can never read across tenants.
- **Privacy filters:** PII minimization in prompts per governance rules (e.g. student identifiers pseudonymized where the feature doesn't need names).
- **Token budgeting:** per-tenant monthly budgets from the plan ([`multi-tenancy.md`](../02-architecture/multi-tenancy.md) §6), per-feature sub-limits, per-user rate limits. Soft threshold (80%) warns tenant admins; hard limit degrades gracefully. Usage metered per call into the platform-admin usage views.
- **Audit logging:** prompt template id, input references, output, model, tokens, latency, approver — retained per governance policy.
- Async execution through Celery for batch features (202 + job pattern per [`api-architecture.md`](../02-architecture/api-architecture.md) §2.7).

### 2. Features by persona (build order)

Ordered so lower-risk drafting features ship before analytics that could drive decisions about children:

| Wave | Persona | Features (see [`ai-features.md`](../04-ai/ai-features.md)) | Human-approval gate |
| ---- | ------- | ------------------------------------------------ | ------------------- |
| 1 | **Admin / school staff** | AI-drafted announcements & notices, document summarization, NL search over school data, NL dashboard queries | Drafts only — a permitted staff user must review and send/publish |
| 2 | **Teacher** | Lesson plans, assignments, quizzes, exam questions, question-bank generation, grading assistance | Teacher approves every artifact before students see it; grading suggestions never auto-post marks |
| 3 | **Student / Parent** | Student study assistant; parent Q&A over their own children's data; suggested parent communications | Assistants answer only from the requester's RLS scope; suggested messages sent only by staff action |
| 4 | **Analytics** | At-risk student detection, attendance anomaly detection, fee-payment prediction, admission lead scoring, timetable recommendations | Outputs are flags/insights for staff review — never automatic actions on a student, fee, or applicant |

Each feature ships flagged per tenant, with the in-product AI disclosure labels the governance doc requires.

### 3. Human-approval gates (design rule)

Any AI output that would (a) modify a record, (b) reach a parent/student, or (c) influence a consequential decision (marks, admission, fee action) must pass through an explicit approval UI with an audit trail of who approved what. "Draft, review, commit" is the universal pattern; features that cannot support it don't ship.

### 4. Evaluation harness

- **Golden datasets** per feature (e.g. 50 lesson-plan briefs, 100 NL-search queries with expected filters, anonymized attendance series with known anomalies), curated with pilot-school input.
- Automated evaluation runs in CI on prompt/model changes: task-specific scoring (structure validity, retrieval correctness, rubric scoring via LLM-as-judge with human calibration sample).
- Regression thresholds: a prompt or model change that drops a feature's score below its baseline blocks merge.
- Production feedback loop: thumbs up/down + edit-distance-before-approval captured per output, reviewed weekly and folded into the datasets.

### 5. Rollout & monitoring

- Progressive enablement: internal tenant → pilot tenants (wave by wave) → default-on per plan.
- Gateway dashboards: token spend per tenant/feature, latency, fallback rate, approval-rejection rate (a quality proxy), budget-limit hits.

## Deliverables

- AI gateway in production code: provider abstraction, budgets, privacy filters, audit log, fallback chain.
- Persona features (waves 1–4) implemented, flagged, and disclosed in-product.
- Evaluation harness with golden datasets and CI integration; baseline scores recorded.
- Token budget configuration surfaced in platform-admin plans and tenant usage views.
- Governance evidence pack: per-feature checklist sign-offs per [`ai-governance.md`](../04-ai/ai-governance.md).

## Roles Involved

- **Backend/AI engineers** (gateway, features, evals) · **Frontend engineers** (assistant UIs, approval flows) · **Tech lead** (model/prompt review, cost control) · **QA** (eval datasets, adversarial testing — prompt injection, cross-tenant probing) · **BA + pilot teachers/admins** (golden-data curation, usefulness validation) · **Client sponsor** (governance sign-off).

## Exit Criteria

Matches [`phase-plan.md`](phase-plan.md) §3: **AI features pass the governance checklist**, specifically:

1. Every shipped feature has a signed governance checklist (approval gate, privacy review, disclosure, fallback).
2. Evaluation harness green with baselines ≥ agreed quality bars; adversarial suite (prompt injection, data-exfiltration attempts, cross-tenant probes) passing.
3. Token budgeting enforced and observable per tenant; cost-per-feature model reviewed against plan pricing.
4. Pilot-tenant usage validates the Phase 0 success metric direction (staff actually approve and use outputs).
5. Kill switch verified: any feature or the whole gateway can be disabled per tenant in one action.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Prompt injection via school data (e.g. a crafted notice) exfiltrates data | Data breach | Treat all record content as untrusted; scoped retrieval only; adversarial CI suite |
| Token costs exceed plan economics | Margin erosion | Budgets + metering from day one; cost-per-feature review at exit; cheaper-model fallback tiers |
| AI quality inconsistent across tenants' data quality | Feature distrust | Golden datasets from real pilot data; edit-distance monitoring; per-feature quality bars |
| Staff rubber-stamp approvals | Governance theater | Rejection/edit rates monitored; features with ~100% no-edit approval get quality re-review |
| Provider outage or model deprecation | Feature downtime | Provider-agnostic gateway, fallback chain, explicit degraded states |
| Analytics flags misused as verdicts on students | Harm + reputational risk | Insights framed with explanation + confidence; no automatic actions; training material in [`phase-7-operate.md`](phase-7-operate.md) covers interpretation |
