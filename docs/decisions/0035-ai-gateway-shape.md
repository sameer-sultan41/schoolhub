# 0035. One AI provider behind `core/ai`; feature endpoints live in their owning module

- **Status:** Accepted
- **Date:** 2026-11-10
- **Enforced by:** `apps/api/core/ai/tests/test_boundaries.py` (`test_anthropic_imported_only_in_adapter`: the SDK is imported in the adapter only); `core/ai/tests/test_service.py` and `test_audit_commit.py` (gate order, one committed row per call, the 429/503 codes); `core/ai/tests/test_anthropic_adapter.py` (`test_deadline_bounds_total_retry_time`); `apps/fees_finance/tests/test_report_summary.py` (the first feature end to end) and `test_report_summary_commit.py` (decision 4 under token-only auth and real transactions); `core/ai/tests/test_evals.py` and the `ai-evals` workflow (a missing baseline or secret fails). Putting a new feature's endpoint in its own module rather than in `core/ai` is review only

## Context

The AI gateway's first feature is AI-FEE-02, a summary of a finance report
([`ai-features.md`](../04-ai/ai-features.md), [`fees-finance.md`](../03-modules/fees-finance.md) §14).
[`ai-architecture.md`](../02-architecture/ai-architecture.md) §2 and §4 sketched the gateway as an
`/api/v1/ai/*` service with a Redis budget limiter and a secondary provider for failover. Building it
showed three of those choices do not fit yet. Decided in plan
[`docs/superpowers/plans/2026-11-07-ai-gateway.md`](../superpowers/plans/2026-11-07-ai-gateway.md)
(user decisions of 2026-11-07: a staff feature first, Claude only, degrade instead of failing over).

## Decision

1. **One provider, one bounded retry, then an explicit 503.** The Anthropic SDK client is built with
   `max_retries=0`. The adapter retries once, only for a retryable failure, and only when the retry
   still fits inside the 30 s overall deadline (`AI_REQUEST_DEADLINE_SECONDS`); a `retry-after`
   beyond it is not waited out. After that the caller gets `503 ai_unavailable`. There is no
   secondary provider at launch.
2. **A feature's endpoint lives in the module that owns its data.** `core/` may not import an app
   ([ADR-0013](0013-cross-app-dependencies.md)), so `core/ai` cannot build a finance report's
   context. AI-FEE-02 is `POST /reports/finance-summary:summarize` in `apps/fees_finance`, which
   calls `core.ai.service.run_feature`. `core/ai` keeps only its own endpoints: `GET /ai/usage` and
   `POST /ai/requests/{id}:feedback`. Features register from each app's `ai.py`
   (`core.ai.registry.load_module_ai`), the `core/files/purposes.py` pattern.
3. **The budget meter is a database sum, not a Redis reservation.** `budget.used_this_month` and
   `used_today` sum `ai_requests` in the tenant's timezone before each call. Concurrent calls can
   overshoot: by at most *concurrency × (context size + `max_output_tokens`)*. The per-user `ai`
   throttle (`10/min`, `AIRequestThrottle`) bounds the concurrency of any one user.
4. **The transaction shape is fixed.** A view that calls the gateway is `non_atomic_requests`. Its
   permission and flag checks and its context reads run in explicit tenant transactions (the tenant
   binding is a `SET LOCAL`); `run_feature` runs its gates in one short `tenant_atomic`, calls the
   provider with no transaction open, and commits its `ai_requests` row in its own `tenant_atomic`
   before any exception leaves it. A 403, 429 or 503 therefore still leaves exactly one row.
5. **Numbers are grounded, not trusted.** The model writes `{{fact:<key>}}`; the server substitutes
   the value. An answer with a digit outside a placeholder or an allowlisted label is refused
   (`core.ai.grounding`), and still counts toward the budget. **Limitation:** the check sees digits
   only, so a figure spelled in words ("twelve families") passes it. The prompt forbids that, and the
   golden case `adversarial-numbers-in-words` fails the evals if the model does it; parsing number
   words in every language a school writes in is not attempted.
6. **Evals run on the real provider, against a committed baseline.** `run_ai_evals --feature <key>`
   scores the feature's golden set and fails when a score falls below the baseline's tolerance,
   when an adversarial case leaks, when the baseline is missing, or when no API key is set. Current
   Claude models take no sampling parameters (the SDK removed `temperature`), so runs are not
   bit-for-bit repeatable; the tolerance absorbs that. `workflow_dispatch` runs only once the
   workflow is on `main`, so the first baseline comes from the PR itself: add the environment's
   `ANTHROPIC_API_KEY` secret, add the label `ai-evals:write-baseline` (that run writes the baseline
   and uploads it as an artifact instead of comparing), commit the artifact's `baseline.json`,
   remove the label and push; the comparison then passes.

## Alternatives considered

- **A secondary provider now** — why not: it doubles the redaction review, the evals and the data
  processing agreement for one read-only feature. Recorded in `deferred-work.md`.
- **Feature endpoints under `/api/v1/ai/*`** — why not: core would have to import every module's
  report code, which ADR-0013 forbids.
- **A Redis reservation for the budget** — why not yet: it is better under load, but there is no
  concurrency to justify it, and the overshoot bound above is small and recorded.
- **Calling the provider inside the request transaction** — why not: a 30 s call would hold a
  connection's transaction, and the audit row of a refusal would roll back with its error response.
- **Literal matching of figures against the facts** — why not: it refuses legitimate formatting,
  and the validator could not see the facts.

## Consequences

A new AI feature is an `ai.py` in its module (feature, context allowlist, eval suite), a prompt file,
a default-off flag and a module endpoint shaped like `FinanceReportSummaryView`. The kill switch
`ai.gateway` is on platform-wide and can only be forced off. Provider outages and spent budgets are
explicit errors (`503 ai_unavailable`, `429 ai_quota_exceeded` with `meta.scope`), never a silent
answer. Revisit the Redis reservation and a second provider when usage justifies them.
