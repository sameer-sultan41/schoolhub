# AI Governance

> **Agent Context**
> **Summary:** Policy for every AI feature in [`ai-features.md`](ai-features.md): data protection for children's data (minimization, PII redaction, pseudonymization, no-training provider terms), the human-approval matrix, provider selection and exit strategy, token/cost management, model and prompt monitoring, fallback rules, transparency labeling, acceptable-use limits, and audit requirements. Enforced technically by the AI Gateway ([`../02-architecture/ai-architecture.md`](../02-architecture/ai-architecture.md)); security requirements cross-reference [`../06-security/security.md`](../06-security/security.md) (notably SEC-16, SEC-17). A feature that cannot satisfy this policy does not ship — this is the "governance checklist" gate in [`../01-phases/phase-3-ai.md`](../01-phases/phase-3-ai.md).
> **Co-load with:** [`ai-features.md`](ai-features.md) · [`../02-architecture/ai-architecture.md`](../02-architecture/ai-architecture.md) · [`../06-security/security.md`](../06-security/security.md)

## 1. Data Protection & Privacy

The platform processes minors' PII (SEC-17). AI features add an external data flow — to the LLM provider — and are therefore governed more strictly than any internal feature.

1. **Minimum-necessary context.** The gateway's Context Builder assembles prompts from scoped queries only — never raw table dumps. Each feature declares its context schema (fields, row limits) in code; adding a field is a reviewed change.
2. **PII redaction before provider calls** (SEC-17 rule 4). Before any external model call, the gateway removes or transforms direct identifiers not required by the feature:

   | Rule | Data classes | Applies to |
   | ---- | ------------ | ---------- |
   | **Always removed** | Government ID numbers, credentials/secrets, bank/salary details, medical notes, guardian contact details (phone/email/address), photos and document images | Every feature — except OCR intake features, where the document *is* the input and is sent for extraction only |
   | **Pseudonymized** | Student/staff names and admission numbers, replaced by stable per-request tokens (`Student-A`, `S-104`) | Analytics and scoring features (`AI-STU-01/02`, `AI-ATT-01/02`, `AI-FEE-01/04`, `AI-HRL-01/02`, `AI-ADM-01`, `AI-STF-01`); the token map never leaves the backend and is re-applied to responses before display |
   | **Retained only where essential** | First name and class for drafting that must address a person; a child's records within `own` scope for that child's guardian | `AI-ATT-03`/`AI-COM-01`/`AI-FEE-03` drafts; `AI-PAR-01/02` guardian features |

   Redaction rules are code (declared per feature next to its context schema), unit-tested, and covered by the adversarial CI suite — not an operational habit.
3. **Children's data guardrails.** Student-facing assistants (`AI-PAR-03`) run age-appropriate system prompts with hard topic guardrails; student/parent assistants access `own`-scoped records only; dropout/at-risk scores are never shown to students or guardians.
4. **No-training provider terms.** Only providers whose API tier contractually guarantees **no training on submitted data** and bounded retention (zero or short-lived abuse-monitoring retention) may be configured. The signed data-processing agreement is a Phase 3 entry criterion.
5. **Data residency & subprocessors.** The provider is listed as a subprocessor in tenant terms; regional endpoint options documented per deployment region (recommendation).
6. **Logs are PII-minimized.** The AI audit log stores prompt template IDs and input *references*, not raw prompt bodies containing student PII (see §9).
7. **Tenant consent & control.** AI processing is disclosed in tenant terms; every feature is flagged per tenant with a kill switch ([`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §5), so a school can opt out of any feature or all of AI.

## 2. Human-Approval Matrix

Design rule (from [`../01-phases/phase-3-ai.md`](../01-phases/phase-3-ai.md) §3): any AI output that would (a) modify a record, (b) reach a parent/student/the public, or (c) influence a consequential decision must pass an explicit approval UI with an audit trail. Per-feature detail is in [`ai-features.md`](ai-features.md); by class:

| Feature class | Examples | Approval rule |
| ------------- | -------- | ------------- |
| Outbound content (announcements, notices, parent messages, website copy) | `AI-COM-01/02/03`, `AI-ATT-03`, `AI-FEE-03`, `AI-WEB-01/02/03` | **Always** — a permitted staff user edits/approves; the module's normal `publish`/send gate is the enforcement point |
| Teaching artifacts reaching students | `AI-ACA-01`, `AI-EXM-01` | **Always** — the teacher approves every artifact/question before students see it |
| Marks & grading | `AI-EXM-02` | **Always** — AI never writes to `marks`; the teacher confirms every suggested score |
| Record-creating drafts | `AI-SCH-01`, `AI-PLA-01/03`, all OCR intake (`AI-ADM-03`, `AI-STU-03`, `AI-STF-02`, `AI-CRT-03`, `AI-INV-02`, `AI-LIB-03`), `AI-ACA-03`, `AI-TTB-01/02/03`, `AI-INV-01`, `AI-TRN-01` | **Always** — human confirms before any record is created or changed |
| Risk analytics & insights | `AI-STU-01/02`, `AI-ATT-01/02`, `AI-FEE-01/04`, `AI-HRL-01/02`, `AI-EXM-03/04`, `AI-STF-01/04`, `AI-ADM-01/04`, `AI-RPT-03`, `AI-PLA-02` | No approval gate because outputs are **advisory only and staff-facing**; they may never trigger an automatic action, and any follow-on communication or decision goes through its own gate |
| Read-only Q&A / search / summaries | `AI-GEN-01/02/03`, `AI-RPT-01/02`, per-module NL queries, `AI-PAR-01/02/03`, `AI-CRT-01` (draft annotation), `AI-STU-04` | No approval gate; bounded instead by RBAC/RLS scope, tool whitelists, and logging |

### 2.1 Approval mechanics

- The approval point is always the **owning module's existing gate** (its `publish`/`approve`/send permission) — AI adds no parallel approval system, so RBAC, workflow configuration, and audit behave identically for AI-drafted and human-drafted content.
- Approvers must hold the owning module's permission key ([`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md)); where segregation-of-duties applies, a user cannot approve AI output into a workflow step they initiated.
- Drafts are stored with `status = draft` on the owning entity and are invisible to students/parents/the public until approved; an unapproved draft expires or is archived per module retention rules (recommendation).
- Approval-rejection and edit-distance rates are monitored per feature — a feature approved ~100% unedited triggers a quality re-review, not a celebration (rubber-stamping is governance failure).
- If the approval UI for a feature class cannot be built (e.g. output volume makes per-item review impractical), the feature does not ship in that form; sampling-based review is not an accepted substitute for consequential classes.

## 3. Acceptable-Use Limits

1. **No automated consequential decisions.** AI never decides — even "by default" — a grade, promotion, disciplinary action, admission outcome, fee waiver/penalty, or staff performance rating. It drafts, scores, and flags; a human with the right permission decides. `AI-STF-01` is explicitly excluded from automated staff decisions; `AI-ADM-01` never auto-rejects a lead.
2. **Assistants never fabricate school data.** Assistant answers must come from tool-returned records; if the tools return nothing, the assistant says so. Numeric/factual answers carry data citations (`AI-PAR-01` pattern generalized to all assistants).
3. **Scope honesty.** An assistant asked about data outside the caller's permission scope refuses and explains, rather than guessing; cross-tenant questions are impossible by construction (RLS) and additionally refused.
4. **Untrusted content stays untrusted.** All record content (notices, applications, uploaded documents) is treated as potentially adversarial (prompt injection); tools re-check permissions on every call, and the adversarial CI suite (injection, exfiltration, cross-tenant probes) must pass before each release.
5. **Student assistant limits.** `AI-PAR-03` does not complete graded work for students verbatim, does not discuss other students, and escalates safeguarding-relevant inputs to a tenant-configured contact (recommendation).

## 4. Provider Selection & Exit Strategy

- **Selection criteria (in priority order):** contractual no-training + retention terms (§1.4); safety/guardrail quality for child-adjacent use; tool-use and structured-output reliability; latency and streaming support; regional availability; price per token across tiers.
- **Primary:** Anthropic Claude API *(recommendation, per [`ai-architecture.md`](../02-architecture/ai-architecture.md))*; **secondary:** one alternative provider configured for failover and price leverage.
- **Exit strategy:** all provider access goes through the Provider Adapter — no provider SDK types outside it; prompts are provider-neutral templates versioned in-repo; the evaluation harness (§6) re-baselines any candidate model, so switching provider or model is a config change plus an eval run, not a rewrite. Contracts avoid volume lock-in beyond 12 months (recommendation).
- **Deprecation handling:** provider model-retirement notices tracked; every feature pins a model version and upgrades only through an eval-gated change.

## 5. Token & Cost Management

- **Plan quotas:** each subscription plan carries a monthly AI-token quota ([`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §6); enforcement is server-side in the gateway (SEC-16: AI calls are quota-bound like SMS).
- **Per-user caps:** daily per-user rate/token limits prevent one user consuming a tenant's budget; per-feature sub-limits keep one feature from starving others.
- **Thresholds:** soft warning to tenant admins at 80%; hard stop at 100% with a graceful in-product message (never a silent failure or an error page).
- **Model tiers:** cheap/fast models for classification, extraction, and summarization; top-tier models for assistants and generation. Tier assignment per feature is code-reviewed and revisited against the cost-per-feature report at each phase exit.
- **Caching:** prompt-prefix caching for stable system prompts and tenant context; response caching for idempotent read queries (NL search over unchanged data) with tenant-scoped cache keys and short TTLs.
- **Metering:** every call meters `tenant, feature, model, tokens` into platform-admin usage views; spend-anomaly alerts fire on per-tenant or per-feature spikes.

## 6. Model & Prompt Monitoring

- **Evaluation harness:** golden datasets per feature (briefs, queries with expected filters, anonymized series with known anomalies) run in CI on every prompt or model change; a score below the feature's recorded baseline blocks merge ([`phase-3-ai.md`](../01-phases/phase-3-ai.md) §4).
- **Drift detection:** weekly scheduled eval runs against production model versions (providers update models); baseline deltas alert the tech lead even when no code changed.
- **Runtime metrics:** error rate, latency, token spend, refusal rate, fallback rate per tenant/feature.
- **Feedback loop:** thumbs up/down + comment on every AI output; edit-distance-before-approval captured on draft features; reviewed weekly and folded back into golden datasets and prompt iterations.
- **Prompt change control:** prompt templates are versioned in the repo and deployed like code — reviewed, evaluated, revertible; the audit log records `prompt_version` per response.

## 7. Fallback & Degradation

1. Provider timeout → one retry → secondary provider → feature-specific degradation.
2. **Degradation is explicit, never silent:** assistants state that AI is unavailable; batch jobs reschedule; NL catalog search falls back to deterministic full-text search (`AI-LIB-02` pattern); UI hides AI panels when a feature flag is off.
3. **Deterministic cores never depend on AI:** timetable conflict detection, attendance capture, marks computation, and fee math all run without the gateway — AI outage degrades convenience, never correctness.
4. Budget exhaustion (§5) degrades identically to provider outage from the user's perspective, with a quota-specific message for tenant admins.
5. **Kill switch:** any feature, or the entire gateway, can be disabled per tenant in one action; verified as a Phase 3 exit criterion.

## 8. Transparency & Labeling

- Every AI-produced output is labeled **"AI-generated"** in the UI at the point of consumption — drafts in editors, report narratives, digests, risk flags — and drafts keep an "AI-drafted, approved by {user}" provenance note after approval (recommendation on wording; the label itself is mandatory).
- Risk scores and anomaly flags always display their **reason codes/score factors** (`AI-ADM-01`, `AI-STU-01` pattern) — no unexplained numbers about a child.
- Public-facing assistants (`AI-ADM-02`) identify themselves as automated and offer a human-contact path.
- Tenants receive plain-language feature descriptions (what data each feature reads, who approves) for staff/parent communication; staff-visible AI insights about staff (e.g. `AI-STF-01`) require tenant opt-in with staff disclosure.

## 9. Audit Requirements

- **Every gateway call** logs: `tenant_id, user_id, feature_key, prompt_version, model, input references (not raw PII), output reference, tokens, latency, outcome (ok/fallback/refused/quota)` — append-only, per [`auth-and-rbac.md`](../02-architecture/auth-and-rbac.md) §4 conventions.
- **Every approval/rejection** of AI output logs approver, timestamp, and the edit delta reference on the owning module's audit trail.
- **Retention:** AI audit records follow the platform audit-retention policy ([`../07-quality/non-functional.md`](../07-quality/non-functional.md)); raw provider payload logs, where kept for debugging, are PII-redacted and short-lived (≤ 30 days, recommendation).
- **Tenant visibility:** `school_owner`/`it_admin` can view their tenant's AI usage and approval logs; platform staff see cross-tenant *metrics*, never row-level content.

## 10. Per-Feature Governance Checklist (ship gate)

Each feature launches only with signed evidence for every item below — this is the "governance checklist" named in [`phase-3-ai.md`](../01-phases/phase-3-ai.md) exit criteria. No checklist, no launch.

1. **Approval gate** implemented and tested for the feature's class per §2 (or documented as advisory/read-only per §2's exempt classes).
2. **Privacy review** signed: context schema reviewed, redaction/pseudonymization rules (§1.2) implemented and unit-tested.
3. **Scope enforcement** verified: RBAC + RLS tests, including cross-tenant and cross-scope probes, pass for every tool the feature exposes.
4. **Disclosure labels** (§8) present on every output surface.
5. **Fallback path** (§7) exercised in staging: provider timeout, secondary failover, quota exhaustion, and kill switch.
6. **Evaluation baseline** (§6) recorded with the golden dataset checked in and running in CI.
7. **Budget metering** (§5) verified: usage appears in platform-admin views; caps enforce.
8. **Adversarial suite** (prompt injection, data-exfiltration, cross-tenant probing) green for the feature's tools.

## 11. Roles & Escalation

- **Tech lead** owns model/prompt changes, tier assignments, and cost review; **client sponsor** signs the governance checklist per feature; **QA** owns golden datasets and the adversarial suite; **platform support** owns tenant kill-switch operations.
- Suspected AI data leakage (PII in a provider payload, cross-scope answer, injection success) is a security incident: gateway or feature kill switch first, then the SEC-21 incident-response flow in [`../06-security/security.md`](../06-security/security.md). Provider-side breaches follow the subprocessor notification terms in the DPA.
- This policy is versioned with the docs; material changes (new data classes to providers, new approval-exempt feature classes) require client sign-off before deployment.
