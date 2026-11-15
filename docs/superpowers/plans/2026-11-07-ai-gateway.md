# AI Gateway and Finance Report Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes. **Never run tests, linters or typechecks
> locally** (ADR-0007): commit, push, read CI. Regenerate `apps/api/openapi.yaml` and
> `packages/api-client/src/schema.d.ts` with the generators (L2). No AI attribution in commits or PRs.
> Load `schoolhub-backend-module` and `schoolhub-testing`. Every subagent brief carries
> `docs/07-quality/agent-lessons.md` §2 (L11), with one named carve-out: editing `apps/api/.env.example`
> (a committed template, not an env file) is approved for this plan.

**Work tier:** 2

**Goal:** Build the platform's one AI gateway, `core/ai`, with governance enforced in code: redaction,
budgets, an audit trail, kill switches and disclosure. Ship its first feature, AI-FEE-02: a plain-language
summary of a finance report for the staff who may read that report.

**Architecture:**
- **`core/ai` owns everything provider-shaped:**
  - a provider adapter, the only module that imports `anthropic` (governance §4);
  - a feature registry filled from each app's `ai.py` by `load_module_ai()` (the `core/files/purposes.py`
    auto-discovery pattern; ADR-0013);
  - a budget meter;
  - a pseudonymizer;
  - grounded-fact templating;
  - append-only audit tables;
  - `run_feature()`. It runs its gates in one short `tenant_atomic`, calls the provider **outside any
    transaction**, then commits the audit row in its own `tenant_atomic` *before* any exception is raised.
- **AI-FEE-02 lives in `apps/fees_finance`:**
  - a per-kind field **allowlist**;
  - an SQL aggregate context (not the 1000-row inline rows);
  - a versioned prompt;
  - the endpoint `POST /reports/finance-summary:summarize`.

**Tech stack:**
- **Backend:** Django 6.1 + DRF, drf-spectacular, PostgreSQL RLS.
- **Provider:** the `anthropic` Python SDK.
- **Models:** tiers `fast` and `standard` map to the pinned model ids in settings. Verify the ids against
  Anthropic's models list at implementation time; the user's environment lists `claude-haiku-5-5` and
  `claude-sonnet-5-5`.

**Spec:**
- **Architecture:** `docs/02-architecture/ai-architecture.md` §1-§6.
- **Governance:** `docs/04-ai/ai-governance.md` §1-§11.
- **Features:** `docs/04-ai/ai-features.md:36` (AI-FEE-02: sync ask, read-only, wave 1).
- **Module:** `docs/03-modules/fees-finance.md` §4, §13, §14, §20.
- **Phase:** `docs/01-phases/phase-3-ai.md`.
- **Data model:** `docs/05-database/entities/tenancy.md`.
- **User decisions, 2026-11-07:**
  - a staff feature first;
  - Claude only, with no second provider at launch;
  - degrade gracefully instead of failing over.

**Base:** `main`; branch `feat/ai-gateway`. This plan is backend only: no dashboard screen hosts finance
reports yet, so the UI is deferred.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| **Provider fallback** | One provider. One bounded retry inside a 30 s overall deadline, then an explicit `503 ai_unavailable`. ADR-0035 amends ai-architecture §4. | **A secondary provider now:** it doubles the redaction review, the evals and the DPA for one read-only feature. |
| **Endpoint home** | The owning app (`/reports/finance-summary:summarize`). | **`/api/v1/ai/*` in `core/ai` (ai-architecture §2):** core can't import the report code (ADR-0013). ADR-0035 records the change and §2 is amended. |
| **Authorisation** | A new key, `fees.report.summarize`, for the same roles as `fees.report.view` (`accountant`, `school_owner`, `principal`). | **POST mapped to `fees.report.view`:** it fails `WritePermissionContractTests`, and a school couldn't grant reports without AI. |
| **Numbers** | Grounded templating. The model writes `{{fact:<key>}}` placeholders, and the server substitutes the values. Any digit outside a placeholder and outside the allowlisted labels (`Cashier-N`, aging bucket names, years in the period) is refused. | **Literal matching of digits against `facts`:** it refuses legitimate formatting and can't see `facts`. **Trusting the model:** governance §3.2 and §7. |
| **Report data** | Bucket totals and counts aggregated in SQL over the caller's scoped queryset (new `services.report_summary_facts`). Facts always cover the full set; the table is downsampled to ≤ 50 rows. | **`build_report_rows(limit=1001)`:** a school with more than 1000 owing families gets a 422 on the summary it most needs. |
| **Budget meter** | A database sum over `ai_requests` in the tenant's timezone. The overshoot bound is concurrency × (context cap + `max_output_tokens`), capped by the per-user `AIRequestThrottle` and recorded in ADR-0035. | **A Redis reservation (ai-architecture §2):** better under load, but no concurrency exists yet to justify it. It's deferred, and §2 is amended. |
| **Kill switch** | `ai.gateway`: `default_enabled=True, is_kill_switch=True` (on platform-wide; ops or a tenant override can only turn it off). The per-feature `ai.fee-report-summary` (`default_enabled=False`) is the per-tenant opt-in. | **A default-off kill switch:** it can never be turned on, because overrides only force off and `sync_feature_flags` rewrites defaults. |
| **Audit store** | New `ai_requests` and `ai_request_feedback` tables (`AppendOnlyTenantModel`, RLS). They hold references and counts, never raw prompts or output (governance §1.6). | **`AuditLog`:** it has no tokens or outcome fields, and no RLS. |
| **Approval** | None. The output is read-only advisory and labelled "AI-generated" (governance §2, §8). | **Draft and approve:** the spec marks AI-FEE-02 "No — read-only". |
| **Warning threshold** | 80 % (governance §5). `platform-admin.md`'s example is fixed. | **90 %.** |

## Global Constraints

- **The SDK boundary:** `anthropic` is imported only in `core/ai/providers/anthropic.py`, and no SDK type
  crosses it. An `ast` scan enforces this.
- **Settings** go in `config/settings/base.py` via `env()`:

  | Key | Value |
  | --- | --- |
  | `ANTHROPIC_API_KEY` | default `""` |
  | `AI_PROVIDER` | `"anthropic"` (test settings: `"fake"`) |
  | `AI_MONTHLY_TOKEN_BUDGET_DEFAULT` | `1000000` |
  | `AI_USER_DAILY_TOKEN_CAP` | `50000` |
  | `AI_MODEL_FAST`, `AI_MODEL_STANDARD` | pinned snapshot ids |
  | `AI_REQUEST_DEADLINE_SECONDS` | `30` |

  Add every new key to `apps/api/.env.example`. Remove both entries from `tests/test_env_example.py`'s
  `NOT_READ_BY_SETTINGS`.
- **The transaction rule:**
  - `FinanceReportSummaryView` is `non_atomic_requests`.
  - Gates and context run in `tenant_atomic`.
  - The provider is called with no transaction open.
  - The `ai_requests` row is committed in its own `tenant_atomic` before raising.
  - A 429 or 503 leaves exactly one committed row.
- **Gate order in `run_feature`:**
  1. gateway flag;
  2. feature flag;
  3. provider configured;
  4. tenant monthly budget;
  5. user daily cap;
  6. provider call;
  7. `stop_reason == "end_turn"`;
  8. the feature's validator.

  Exactly one row per call.
- **Error codes**, via a `CodedAPIException` marker base that `envelope_exception_handler` keeps the code for
  (extending its existing `isinstance` list):

  | Case | Response |
  | --- | --- |
  | A flag is off | `403 module_disabled` (the existing code) |
  | Quota | `429 ai_quota_exceeded`, `meta.scope` ∈ `tenant\|user` |
  | Provider error, not configured, a non-`end_turn` stop, or validator refusal | `503 ai_unavailable` |
  | Soft warning (≥ 80 % monthly) | `meta.budget_warning: true` |
- **Provider errors:**
  - Every `anthropic.APIError` maps to `ProviderUnavailable`; 4xx (a bad key, 413, 400) are logged at error
    level.
  - The SDK client is built with `max_retries=0`. The adapter does one retry itself, only if time remains
    within the 30 s deadline, and ignores an unbounded `retry-after`.
- **Tokens:** `ProviderResult` carries `input_tokens`, `output_tokens`, `cache_creation_input_tokens` and
  `cache_read_input_tokens`. All four are stored and summed by the budget.
- **Redaction:** each report kind declares a field **allowlist** in `apps/fees_finance/ai.py`. A parametrised
  test over `reports.REPORT_KINDS` fails for any kind with no allowlist. `student-ledger` is refused (`422` on
  `kind`). These never enter a context, at row or table level:
  - names;
  - admission numbers;
  - user ids (`received_by`, `approved_by`);
  - `expense_no`, `description`;
  - discount and scholarship `name`, budget `name`;
  - vendor names;
  - row ids.

  Ledger-account names are allowed but fenced in `<report_data>` as untrusted.
  `Cashier-N` restores to the staff display name (a `staff_management` models import is allowed) via
  `Pseudonymizer.restore()`, run after validation.
- **Flags:** `ai.gateway` (on, a kill switch) and `ai.fee-report-summary` (off).
- **Throttle:** `throttle_classes = [*api_settings.DEFAULT_THROTTLE_CLASSES, AIRequestThrottle]`, where
  `AIRequestThrottle` is scope `ai`, `10/min` per user. It needs the `THROTTLE_RATES` entry, the `dev.py`
  override and a `test_throttle_rates.py` case.
- **Tenant budget override:** `TenantSettings.ai` is a new JSON namespace. No tenant-facing endpoint writes it,
  because the quota is platform-set (SEC-16). A test asserts the settings API refuses it.
- **Permissions:**
  - `fees.report.summarize` (a §4 row);
  - `ai.usage.view` → `school_owner`, `it_admin`;
  - `ai.feedback.create` → `ALL_STAFF`;
  - the permissions table is added to `ai-governance.md` §9.
- **Docs in the same PR:**
  - ADR-0035 (confirm it's the next free number across open PRs at PR time, L7) and the index;
  - `ai-architecture.md` §2 and §4;
  - `ai-governance.md` §1.2 (an AI-FEE-02 row) and §9;
  - `platform-admin.md` (80 %);
  - `fees-finance.md` §4, §14, §20;
  - `docs/05-database/entities/ai.md` (new) and `tenancy.md` (the `ai` namespace);
  - `apps/api/AGENTS.md` rule 6;
  - `project-status.md`;
  - `deferred-work.md`.
- **Lessons:** start at L55.

## Review Focus

1. **Scope.** A campus-scoped accountant's facts cover only their campus. Test: `test_summary_uses_callers_campus_scope`.
2. **Identities in the prompt.** Test: `test_context_keys_are_allowlisted_for_every_kind`, parametrised over
   `REPORT_KINDS`. It inspects the prompt the fake provider received.
3. **Injection via record text.** Free text is dropped and account names are fenced. Test: `test_record_text_is_fenced_and_free_text_dropped`.
4. **Refusals are recorded and counted.** A 429 or 503 commits one row; a validator refusal counts its tokens.
   Tests: `test_refusal_row_survives_the_error_response`, `test_validator_refusal_still_counts_tokens`.
5. **Invented figures.** A narrative with a bare number is refused; placeholders are substituted. Tests:
   `test_invented_number_is_refused_with_503`, `test_placeholders_are_substituted_from_facts`.

---

### Task 1: `core/ai` gateway

**Files:**
- **Create `apps/api/core/ai/`:**
  - `__init__.py`, `apps.py`, `features.py`, `registry.py`;
  - `models.py`, `migrations/0001_initial.py` (with `rls_operations` and `append_only_operations` for both
    tables);
  - `providers/{__init__,base,anthropic,fake}.py`;
  - `budget.py`, `redaction.py` (`Pseudonymizer`), `grounding.py` (placeholder substitution and the digit
    check), `service.py`, `exceptions.py`;
  - `permissions.py`, `serializers.py`, `views.py`, `urls.py`, `tests/`.
- **Modify:**
  - `core/api/exceptions.py` (`CodedAPIException`);
  - `config/settings/{base,dev,test}.py`, `config/api_v1.py`, `core/api/throttling.py`;
  - `core/tenancy/models.py` (`TenantSettings.ai` and its migration);
  - `apps/api/pyproject.toml`: add `anthropic` at the current PyPI release, and add `core.ai.*` to the strict
    mypy list;
  - `uv.lock`, `.env.example`, `tests/test_env_example.py`, `tests/test_throttle_rates.py`.

**Interfaces — Produces:**
- **`AIRequest(AppendOnlyTenantModel)`, table `ai_requests`:**
  - `user_id`, `feature_key(60)`, `prompt_version(40)`, `model(60)`;
  - `input_ref(200)`, `output_ref(200)` (`"ai_request:<id>"` or a sha256, never text);
  - `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`;
  - `latency_ms`;
  - `outcome` ∈ `ok|fallback|refused|quota|disabled`;
  - explicit `created_at`.
  - Indexes: `(tenant_id, created_at)` and `(tenant_id, user_id, created_at)`.
- **`AIRequestFeedback(AppendOnlyTenantModel)`, table `ai_request_feedback`:**
  - `ai_request` (FK, unique), `user_id`;
  - `value` ∈ {-1, 1};
  - `comment` (text ≤ 500, optional; stored only, never sent to the provider);
  - `created_at`.
- **`AIFeature`** (frozen):
  - `key`, `flag_key`, `tier`, `prompt_version`, `system_prompt`, `max_output_tokens`;
  - `validate_output: Callable[[str, GroundingContext], ValidationResult]`.

  `ValidationResult(ok: bool, reason: str | None)`.
- **`GroundingContext(facts: dict[str,str], allowed_labels: frozenset[str])`.** `grounding.render(text, ctx) -> str`
  substitutes `{{fact:key}}`, and `grounding.check(text, ctx) -> ValidationResult`.
- **`Provider.complete(*, model, system, user, max_output_tokens, deadline: float) -> ProviderResult`.**
  - `ProviderResult(text, stop_reason, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, model)`.
  - It raises `ProviderUnavailable`.
  - `FakeProvider` is scripted and records its last call.
- **`run_feature(*, feature_key, user, tenant, user_prompt, input_ref, grounding: GroundingContext, pseudonymizer: Pseudonymizer | None = None) -> AIRun`.**
  - `AIRun(request_id, text, model, prompt_version, budget_warning)`, where `text` is already rendered and
    restored.
- **Budget:**
  - `budget.monthly_limit(tenant)`: `TenantSettings.ai["monthly_token_budget"]`, else the default;
  - `budget.used_this_month(tenant)` and `budget.used_today(tenant, user_id)`: windows in `Tenant.timezone`.
- **Endpoints:**
  - `GET /api/v1/ai/usage` (`ai.usage.view`) → `{data: {month_tokens, monthly_limit, by_feature: [...]}}`;
  - `POST /api/v1/ai/requests/{id}:feedback {value, comment?}` (`ai.feedback.create`):
    - the caller's own request only, else 404;
    - a second vote is 409, including a race, where `IntegrityError` maps to `conflict`.

- [ ] **Failing tests:**
  - **Flags and configuration:**
    - `test_gateway_kill_switch_override_refuses_and_records_disabled`;
    - `test_feature_flag_off_is_403_module_disabled`;
    - `test_missing_api_key_is_503_ai_unavailable`.
  - **Budgets:**
    - `test_monthly_budget_refuses_with_429_ai_quota_exceeded` (asserts `error.code` and `meta.scope`);
    - `test_user_daily_cap_refuses_with_429`;
    - `test_budget_warning_at_80_percent`;
    - `test_budget_windows_use_tenant_timezone`;
    - `test_cache_tokens_count_toward_budget`;
    - `test_tenant_override_budget_wins`;
    - `test_settings_api_cannot_write_ai_namespace`.
  - **Provider behaviour:**
    - `test_refusal_row_survives_the_error_response`;
    - `test_provider_error_degrades_with_503`;
    - `test_provider_4xx_maps_to_503_and_logs_error`;
    - `test_non_end_turn_stop_reason_is_refused`;
    - `test_validator_refusal_still_counts_tokens`;
    - `test_deadline_bounds_total_retry_time`;
    - `test_ok_run_records_tokens_model_prompt_version_latency_output_ref`.
  - **Helpers:**
    - `test_pseudonymizer_aliases_are_stable_and_restored`;
    - `test_grounding_substitutes_placeholders`;
    - `test_grounding_refuses_bare_numbers_but_allows_labels`.
  - **Boundaries and endpoints:**
    - `test_anthropic_imported_only_in_adapter`;
    - `test_usage_is_tenant_scoped_and_keyed`;
    - `test_feedback_only_on_own_request`;
    - `test_second_feedback_is_409`;
    - `test_other_tenants_request_feedback_is_404`.
- [ ] **Finish:** regenerate the contract, then commit `feat(ai): add the core/ai gateway with budgets, redaction and audit`.

### Task 2: AI-FEE-02, finance report summaries

**Files:**
- **Create:**
  - `apps/fees_finance/ai.py`:
    - the feature registration (`fees.report-summary`, tier `fast`, `prompt_version="fees.report-summary@1"`,
      `max_output_tokens=600`, `validate_output=grounding.check`);
    - `CONTEXT_ALLOWLIST: dict[str, frozenset[str]]` per kind;
    - `build_summary_context(...)`.
  - `apps/fees_finance/prompts/report_summary_v1.txt`.
- **Modify:**
  - `features.py`;
  - `permissions.py` (`fees.report.summarize`);
  - `services.py`:
    - `report_summary_facts(*, kind, user, permission, date_from, date_to, group_by) -> SummaryFacts`
      (SQL aggregates over `scoped(...)`);
    - `summarize_report(...) -> ReportSummary`;
  - `views.py`: `FinanceReportSummaryView`:
    - `required_permission = "fees.report.summarize"`;
    - `STAFF_PERMISSIONS`, `required_feature="module.fees_finance"`;
    - `non_atomic_requests`;
    - rows read under `route_permission(request, self)`;
  - `urls.py`, `serializers.py`, `tests/test_cross_tenant.py`.

**Interfaces — Produces:**
- **`SummaryFacts(facts: dict[str,str], table: list[dict[str,str]], input_ref: str)`:**
  - facts span the full scoped set;
  - the table holds ≤ 50 allowlisted rows, downsampled with first, last and largest rows kept.
- **Response:** `{data: {summary, facts, model, prompt_version, ai_request_id, ai_generated: true}, meta: {budget_warning}}`.
- **An empty report** returns `summary=""` with facts, writes an `ok` row with zero tokens, and makes no
  provider call.

- [ ] **Failing tests:**
  - `test_summary_returns_narrative_facts_and_ai_generated_label`;
  - `test_summary_uses_callers_campus_scope`;
  - `test_context_keys_are_allowlisted_for_every_kind`;
  - `test_record_text_is_fenced_and_free_text_dropped`;
  - `test_placeholders_are_substituted_from_facts`;
  - `test_invented_number_is_refused_with_503`;
  - `test_large_aging_report_summarises_without_row_limit`;
  - `test_student_ledger_kind_is_422`;
  - `test_empty_report_makes_no_provider_call_and_records_zero`;
  - `test_report_view_holder_without_summarize_key_is_403`;
  - `test_portal_user_is_403`;
  - `test_flag_off_is_403`;
  - the cross-tenant case in `test_cross_tenant.py`.
- [ ] **Evals:**
  - The golden set is `apps/fees_finance/tests/evals/report_summary_golden.json`: 20 cases, rows in JSON with
    no database, including the injection and "name the students" cases.
  - The command is `run_ai_evals --feature fees.report-summary`. It forces the real provider at temperature 0,
    scores `{{fact}}` usage, forbidden strings and the validator's pass rate, and compares the result with
    `evals/baseline.json` within a tolerance. A **missing baseline fails**.
  - The workflow is `.github/workflows/ai-evals.yml`:
    - triggers: `workflow_dispatch`; weekly `schedule` (drift); `pull_request` on `apps/**/prompts/**`,
      `apps/**/ai.py`, `apps/api/core/ai/**` and `apps/api/config/settings/**`;
    - it uses a spend-capped key in a protected GitHub Environment `ai-evals`;
    - **with no secret, the job fails with a clear message.** It is not a required check until the user adds
      the secret.
  - `baseline.json` is committed from the first dispatched run, before any tenant flag is enabled.
- [ ] **Docs:** as listed in Global Constraints. The `deferred-work.md` entries:
  - SSE streaming;
  - free-form NL questions (they need a campus report filter);
  - scheduled-report summaries;
  - the dashboard UI;
  - platform-admin usage views and plan quotas;
  - the Redis budget reservation;
  - the 80 % admin notification;
  - a second provider;
  - response caching;
  - per-feature sub-limits.
- [ ] **Finish:** regenerate the contract, then commit `feat(fees): summarise a finance report with the AI gateway`.
  Then `change-reviewer`, fix, push, open the PR, and check CI.

## Before enabling for any tenant (governance §10, outside this PR)

The DPA with no-training terms is signed. Staging exercises the fallback (timeout, quota, kill switch). The eval
baseline is committed and green. Usage is visible at `/ai/usage`, and the adversarial cases are green. The PR
lists these as open items.

## Verification

- CI is green: `api` (including the RLS, append-only, import-boundary, env-example, throttle and
  endpoint-contract suites) and `repo-hygiene`.
- `ai-evals` is dispatched once the secret exists, and its baseline is committed.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-07
- **Verdict:** REVISE. The architecture is right, but there were five blockers:
  - the POST was keyed by a read key, which fails `WritePermissionContractTests`;
  - audit rows rolled back under `ATOMIC_REQUESTS`, and the provider call ran inside the transaction;
  - the envelope handler overwrote the AI error codes;
  - a default-off kill switch could never be enabled;
  - the numbers validator couldn't see `facts`.

  Redaction also needed a per-kind allowlist.
- **Findings addressed:** all of them.
  - **Permission:** a new `fees.report.summarize` key.
  - **Transactions:** `non_atomic_requests`, the provider called outside the transaction, and the audit row
    committed before raising.
  - **Error codes:** a `CodedAPIException` marker, and `module_disabled` reused.
  - **Kill switch:** `ai.gateway` is on by default; the per-feature flag is the opt-in.
  - **Validator:** grounded `{{fact}}` templating with the context passed in.
  - **Redaction:** a per-kind allowlist with a parametrised test, `student-ledger` refused, and free text and
    ids dropped.
  - **Report size:** SQL aggregates instead of capped rows.
  - **Budget:** the concurrency bound documented, tenant-timezone windows, and cache tokens counted.
  - **Provider:** a single deadline with `max_retries=0`, all `APIError`s mapped, and `stop_reason` checked.
  - **Evals:** fail without a baseline or secret, temperature 0, the settings paths and a weekly drift run.
  - **Feedback:** a comment field, the table spelled out, and the race giving 409.
  - **Audit:** `output_ref`; the admin notification deferred; the `ai` namespace not tenant-writable.
  - **Placement:** the endpoint home and the database meter are recorded in ADR-0035, with §2 amended.
  - **Keys:** renamed to `ai.usage.view` and `ai.feedback.create`.
  - **Throttles:** the default throttles are kept.
  - **Rows:** read under `route_permission`, with the cross-tenant case in the module suite.
  - **Numbering:** the ADR number and model ids are checked at implementation.
  - **`.env.example`:** named as the briefs' one carve-out.
  - **Edge cases:** the empty report and the `Cashier-N` restore are specified.
- **Resolved by the user, 2026-11-07:**
  - (a) The eval job fails until the `ANTHROPIC_API_KEY` secret exists; the user adds it before merge.
  - (b) Editing `apps/api/.env.example` is approved.
