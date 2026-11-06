# Online Fee Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes. **Never run tests, linters or typechecks
> locally** (ADR-0007): commit, push, read CI. Regenerate `apps/api/openapi.yaml` and
> `packages/api-client/src/schema.d.ts` with the generators (L2). No AI attribution in commits or PRs;
> `fix` commits carry `Root cause:`. Load `schoolhub-backend-module` and `schoolhub-testing`. Every subagent
> brief carries `docs/07-quality/agent-lessons.md` §2 (L11). One named carve-out: editing the committed
> templates `apps/api/.env.example` and `infra/compose/.env.example` is approved for this plan. Real `.env`
> files are never touched.

**Work tier:** 2

**Goal:** A guardian pays a fee invoice online, through the school's own merchant account with a Pakistani
payment aggregator. The payment confirms itself from the provider's signed callback, re-verified with the
provider. A nightly reconciliation catches anything the callback missed, and staff have a booked recovery
path for every discrepancy.

**Architecture:**
- **`core/integrations/payments`** holds the provider-agnostic adapter interface (initiate, verify a callback,
  fetch one transaction, list a day's transactions) and a fake provider.
  **`core/integrations/crypto.py`** encrypts each school's merchant credentials.
- **`fees_finance`** holds the money rules:
  - `PaymentGatewayAccount`;
  - `:initiate-payment`, which commits a `pending` `online_gateway` payment, then calls the provider;
  - a public callback;
  - reconciliation;
  - `GatewayReconciliationIssue`, with booked resolutions.
- **PR 1 (Tasks 1-3)** runs end to end against the fake provider.
- **PR 2 (Task 4)** adds the chosen real provider and the portal Pay button. It is blocked on sandbox keys and
  on the portal stack merging.

**Tech stack:** Django 6.1 + DRF, Celery beat, `cryptography` (`MultiFernet`), PostgreSQL RLS; Next.js 16 in PR 2.

**Spec:**
- **Fees-finance:** `docs/03-modules/fees-finance.md` §4, §7.1, §7.2, §11, §16 L289, §17 L293, §19, §20 L557.
- **Security:** `docs/06-security/security.md` SEC-13 (column encryption; a rotation procedure documented) and
  SEC-15.
- **API:** `docs/02-architecture/api-architecture.md` §2.1, §2.5, §2.6.
- **Extensibility:** `docs/08-future/extensibility.md` §3.
- **Industry reference:** Stripe's webhook guidance (https://docs.stripe.com/webhooks): signature plus
  timestamp tolerance, ordering, duplicates, fetch-to-verify, a fast 2xx.
- **User decisions, 2026-11-07:**
  - Pakistan first, with one aggregator (PayFast or Safepay, chosen after testing both sandboxes);
  - the school is merchant of record;
  - the full available balance only.

**Base:** `main`; branch `feat/fee-online-payments`.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| **Merchant of record** | The school's own account; SchoolHub stores encrypted, write-only credentials. | **A platform account with payouts:** it needs payment-facilitator licensing (user decision). |
| **Credentials at rest** | `MultiFernet` over `INTEGRATIONS_ENCRYPTION_KEYS` (comma-separated, newest first), stored in a `BinaryField`. `rotate_integration_credentials` re-encrypts via `for_each_tenant`, with a runbook. | **Plain `TenantSettings` JSON:** violates SEC-13. **KMS:** not in the stack yet; the `encrypt`/`decrypt` seam takes it later. Fernet has no AAD, so ciphertext isn't tenant-bound. RLS is the boundary, and ADR-0034 records the limit. |
| **SEC-15** | Amended by ADR-0034. Payment credentials are the school's own: write-only, and the masked id is derived server-side by the adapter. | **Platform-held keys:** that is the rejected platform-account model. |
| **Callback tenant resolution** | `POST /api/v1/public/payment-callbacks/{tenant_slug}/{callback_token}`. The slug finds the tenant (`tenants` has no RLS). The view binds `tenant_atomic`, finds the account by token (constant-time compare, **whether or not it's active**), verifies the signature with that account's secret, then re-fetches the transaction from the provider. | **A tenant in the body:** attacker input. **A global reference lookup:** it needs `all_tenants` on an unauthenticated route. |
| **Ids** | `order_id` is ours (`SH-{invoice_no}-{8 hex}`), stored in `reference_no`, and is the lookup key. `provider_txn_id` is the provider's id, in a new nullable column. Unique constraints: `(tenant, gateway_provider, reference_no)` and `(tenant, gateway_provider, provider_txn_id)`, for alive `online_gateway` rows. | **One mixed reference:** a callback keyed by the provider id would never match. |
| **A pending online payment versus other payments** | `available_balance = balance_due − pending online`. The cashier (`payments:record`) and `:initiate-payment` refuse past it. **Money already received** (a late callback, a bank voucher settlement) always posts, and raises an `overpaid` issue if it overpays. | **Blocking the cashier:** the counter keeps working. **Sending a settled voucher to the exceptions queue:** that money has already moved, the same argument as a late callback. |
| **Recovering a discrepancy** | `:resolve {action}` on an issue, gated `fees.gateway.manage` and audited. `book_at_gateway_amount` confirms the payment (or creates and confirms one for an `unknown_reference`) at the amount the provider verified, then raises `overpaid` if needed. `dismiss` needs a note, e.g. "refunded at provider". | **Resolve sets a note only:** money would sit in the school's account with no payment, receipt or ledger entry (L4). |
| **Confirming a failed payment** | `confirm_payment(..., allow_failed=False)`. Only `handle_gateway_event` and `:resolve` pass `True`. | **Implicit:** any caller could confirm a failed payment today. |
| **Amount** | The full available balance (user decision). | **Partial online payments:** deferred. |
| **Provider refunds** | Not in this plan; refunds stay on §7.3's manual flow. | **An adapter `refund`:** each aggregator differs. Deferred. |

## Global Constraints

- **Money is append-only.** `fail_payment` allows only `pending → failed`; anything else is a logged no-op.
  The ledger posting stays inside `confirm_payment`.
- **One lock order:** invoice, then payment. `initiate_online_payment`, `handle_gateway_event`, `fail_payment`,
  `record_payment` and `:resolve` all follow it.
- **No provider HTTP call holds a lock or an open transaction:**
  - `:initiate-payment` commits the pending payment first, then calls `adapter.initiate()`. If the call
    errors, it fails that payment in a new transaction and returns 503.
  - The callback view verifies and fetches outside the transaction, then applies inside `tenant_atomic`.
  - Reconciliation fetches the day's list outside any transaction and applies each event in its own savepoint.
- **System actor:** gateway and reconciliation confirmations have no user.
  - `render_receipt_task` and `create_ready_file` accept `actor_id=None`.
  - `record_audit` gets an `actor=None` variant: `record_system_audit(tenant_id, action, instance, *, context)`.
  - Every gateway confirm, fail and resolve is audited with the provider reference.
- **New keys** (rows in §4):
  - `fees.payment.pay-online` → `guardian`, `student`, scope `own`.
  - `fees.gateway.manage` → `school_owner`, `accountant`.

  Amend the §4 sentence "Financial mutations require record-level scope ≠ `own`" to name the pay-online
  exception: it moves money *in*, for the caller's own child.
- **§11 "amount ≤ balance":** amend it to "a payment *taken* ≤ available balance; money already received
  posts and raises an `overpaid` issue".
- **Callback endpoint:**
  - `authentication_classes = []`, `permission_classes = [AllowAny]`, CSRF-exempt;
  - `throttle_classes = [PaymentCallbackThrottle]`, set explicitly, scope `payment_callback`, keyed on
    `(slug, token)`, `600/min`;
  - a separate `PaymentCallbackFailureThrottle` limits failed signatures per IP to `30/min`;
  - each throttle needs a `THROTTLE_RATES` entry, a `test_throttle_rates.py` `DEFAULT_RATES` case and an
    `.env.example` line for any `THROTTLE_RATE_*` override;
  - responses:

    | Case | Response |
    | --- | --- |
    | Unknown slug or token | `404` |
    | Bad signature or stale timestamp | `400 invalid_signature`, plus `record_security_event` |
    | Valid callback, including duplicates, out-of-order events and a suspended tenant (still recorded) | `200 {"data": {"received": true}}` |
- **Settings:**
  - `INTEGRATIONS_ENCRYPTION_KEYS` is read via `env()`. `dev.py` sets a fixed, documented dev-only default
    (shared by `api` and `celery-worker`), and `test.py` a fixed literal. It is added to both `.env.example`
    files and to the staging and prod Terraform `api_secrets`, since prod requires it at boot.
  - `PAYMENT_PENDING_TTL_MINUTES = 60` (to be revisited in Task 4 against the provider's session lifetime).
  - `PAYMENT_PROVIDERS_ENABLED`: `["fake"]` in dev and test, `[]` in prod until PR 2.
  - `PAYMENT_CALLBACK_TOLERANCE_SECONDS = 300`.
- **Errors:**

  | Case | Response |
  | --- | --- |
  | Invoice not payable | `409 invoice_not_payable` |
  | Nothing to pay | `409 nothing_due` |
  | No gateway account | `409 gateway_not_configured` |
  | Provider down | `503 gateway_unavailable` |
  | Past the available balance | `422` on `amount`, with `meta.pending_online_payment_id` |
- **Feature flag:** `fees.online-payments`, `default_enabled=False`.
- **Docs in the same PR:**
  - ADR-0034 (confirm it's the next free number across open PRs at PR time) and the index;
  - `fees-finance.md` §4, §7.1, §7.2, §11, §16, §17, §20;
  - SEC-13 (the rotation procedure) and SEC-15;
  - `api-architecture.md` §2.6, with an **inbound** bullet extending it, not a new section;
  - entity docs;
  - `infra/runbooks/rotate-integration-credentials.md`;
  - `project-status.md`, `deferred-work.md`.
- **Lessons:** start at L55.

## Review Focus

1. **Forged, replayed or misdirected callbacks.** Tests: `test_bad_signature_is_400_and_confirms_nothing`,
   `test_stale_timestamp_is_400`, `test_replayed_callback_confirms_once`, `test_other_schools_signature_is_rejected`.
2. **Out-of-order events.** A `failed` arriving after `paid` changes nothing. Test: `test_failed_callback_after_confirm_is_noop`.
3. **Amount tampering.** The fetched transaction disagrees with the payment → an `amount_mismatch` issue,
   nothing confirmed, and staff can `book_at_gateway_amount`. Tests: `test_amount_mismatch_records_issue_without_confirming`,
   `test_resolve_book_at_gateway_amount_confirms_and_posts`.
4. **Concurrent money.** The cashier is refused past the available balance. A late callback and a settled
   voucher post and flag `overpaid`. Tests: `test_counter_payment_respects_pending_online`,
   `test_late_paid_callback_after_expiry_confirms_and_flags_overpaid`, `test_voucher_settlement_during_pending_online_posts_and_flags_overpaid`.
5. **Scope and secrets.** Another family's or another tenant's invoice is 404. Credentials are write-only and
   stored encrypted. Tests: `test_initiate_on_invoice_of_other_family_is_404`, `test_other_tenant_invoice_is_404`,
   `test_credentials_are_write_only_and_masked`, `test_credentials_stored_encrypted`.

---

### Task 1: `core/integrations`: crypto and the payment adapter interface

**Files:**
- **Create `apps/api/core/integrations/`:**
  - `__init__.py`, `apps.py`, `crypto.py`;
  - `payments/{__init__,base,registry,fake}.py`;
  - `management/commands/rotate_integration_credentials.py` (it loops through `for_each_tenant` with a
    registered rotator hook, so `core` doesn't import `fees_finance`; `fees_finance` registers its model in
    `ready()`);
  - `tests/`.
- **Modify:**
  - `config/settings/{base,dev,test}.py`;
  - `apps/api/pyproject.toml`: add `cryptography` at the current PyPI release;
  - `uv.lock`;
  - `apps/api/.env.example`, `infra/compose/.env.example`;
  - `tests/test_env_example.py`;
  - `infra/terraform/envs/{staging,production}/main.tf` (`api_secrets`).

**Interfaces — Produces:**
- **`crypto.encrypt(data: dict) -> bytes`, `crypto.decrypt(token: bytes) -> dict`, `crypto.rotate(token: bytes) -> bytes`.**
  `register_rotator(fn: Callable[[], int])`.
- **`CheckoutRequest(order_id, amount: Decimal, currency, description, return_url, callback_url, customer_email: str | None)`.**
- **`CheckoutSession(redirect_url, expires_at: datetime | None)`.**
- **`GatewayEvent(order_id, provider_txn_id, status: Literal["paid","failed"], amount: Decimal, occurred_at, sanitized: dict)`.**
  `sanitized` never holds card data or secrets.
- **The `PaymentAdapter` protocol:**
  - `provider: str`;
  - `can_reinitiate: bool`;
  - `mask_merchant_id(credentials) -> str`;
  - `initiate(request, credentials) -> CheckoutSession`;
  - `verify_callback(headers, body: bytes, credentials, now) -> GatewayEvent`, raising `InvalidSignature`
    (bad HMAC or a timestamp outside the tolerance);
  - `fetch_transaction(credentials, order_id) -> GatewayEvent | None`;
  - `list_transactions(credentials, day: date) -> list[GatewayEvent]`.

  Transport errors raise `GatewayUnavailable`.
- **The registry:** `register_adapter`, `adapter_for(provider)` (raises `LookupError`) and `enabled_providers()`.
- **`FakeAdapter`:**
  - its signature is `HMAC-SHA256(secret, f"{timestamp}.{body}")`, sent as
    `X-Fake-Signature: t=<unix>,v1=<hex>`;
  - `can_reinitiate=False`;
  - an in-memory transaction store the tests fill.

- [ ] **Failing tests:**
  - `test_encrypt_round_trip`;
  - `test_rotation_decrypts_old_and_re_encrypts_new`;
  - `test_decrypt_with_unknown_key_raises`;
  - `test_fake_signature_verifies_and_rejects_tampered_body`;
  - `test_fake_signature_rejects_stale_timestamp`;
  - `test_adapter_for_disabled_provider_raises`;
  - `test_rotate_command_re_encrypts_every_tenant`.
- [ ] **Finish:** implement, then commit `feat(integrations): encrypted credentials and the payment adapter interface`.

### Task 2: Gateway account, `:initiate-payment`, the callback, and the payment rules

**Files:**
- **Modify `apps/api/apps/fees_finance/`:**
  - `models.py`:
    - `PaymentGatewayAccount`;
    - `GatewayReconciliationIssue`;
    - `Payment.provider_txn_id` and the two unique constraints;
    - the partial unique `payments_one_pending_online_per_invoice`;
  - `migrations/` (with RLS);
  - `permissions.py`, `features.py`, `apps.py` (registers the rotator);
  - `services.py`;
  - `serializers.py`, `views.py`, `urls.py`;
  - `tasks.py`: `expire_pending_online_payments`, beat every 15 min, `bulk` queue; `render_receipt_task` takes
    an optional actor.
- **Also modify:**
  - `core/files/services.py` (`create_ready_file` takes an optional actor);
  - `core/audit/services.py` (`record_system_audit`);
  - `core/api/throttling.py`;
  - `config/settings/base.py`.
- **Extract:** `after_payment_confirmed(payment, *, actor_id: UUID | None)` queues the receipt and the
  notification on commit, replacing the inline code in `PaymentViewSet.record`.
- **Tests:** `test_gateway_account.py`, `test_online_payment_initiate.py`, `test_payment_callback.py`,
  `test_gateway_issues.py`; cross-tenant cases in `test_cross_tenant.py`.

**Interfaces — Produces:**
- **`PaymentGatewayAccount(TenantOwnedModel)`, table `payment_gateway_accounts`:**
  - `provider`, `is_active`;
  - `merchant_id_masked`, derived by the adapter;
  - `credentials_ciphertext`;
  - `callback_token`, unique, from `secrets.token_urlsafe(32)`.
  - Constraint: at most one active per tenant.
- **`GatewayReconciliationIssue(TenantOwnedModel)`, table `gateway_reconciliation_issues`:**
  - `kind` ∈ `amount_mismatch|overpaid|unknown_reference|missing_at_gateway|paid_after_failed|duplicate_at_gateway`;
  - `payment` (nullable), `order_id`, `provider_txn_id`, `expected_amount`, `gateway_amount`, `detected_at`;
  - `resolution` ∈ `booked|dismissed`, plus `resolved_at`, `resolved_by` and `note`, set once.
  - Unique: an open issue per `(payment, kind)`.
- **Services:**
  - `available_balance(invoice) -> Decimal`.
  - `initiate_online_payment(*, invoice, user, tenant, return_path, idempotency_key) -> tuple[Payment, CheckoutSession]`:
    - under the invoice lock, a live pending payment is returned with its stored redirect if the adapter
      can't re-initiate;
    - a pending payment past its TTL is `fail_payment`ed first;
    - otherwise a new pending payment is created and committed;
    - then the provider is called.
  - `handle_gateway_event(*, account, event, source: Literal["callback","reconcile"]) -> Payment | None`:
    1. Re-fetch via `fetch_transaction`.
    2. Look up by `order_id`. If there is no match → `unknown_reference`.
    3. `paid` with a different amount → `amount_mismatch`.
    4. `paid` → `confirm_payment(allow_failed=True)`, plus `paid_after_failed` and/or `overpaid` as they apply.
    5. `failed` → `fail_payment`, a no-op unless pending.
    6. Store `provider_txn_id` and `sanitized`.
  - `fail_payment(*, payment, reason) -> Payment`.
  - `resolve_gateway_issue(*, issue, action: Literal["book_at_gateway_amount","dismiss"], note, actor_id) -> GatewayReconciliationIssue`.
  - `record_payment` refuses past `available_balance`, unless called with `money_received=True`, which only
    `apply_settlement_rows` passes. That path then raises `overpaid` when needed.
- **Endpoints:**
  - `GET/PUT /api/v1/payment-gateway-accounts/current` (`fees.gateway.manage`, staff):
    - the PUT body is `{provider, credentials, is_active}`; credentials are write-only;
    - the response carries `merchant_id_masked` and `callback_url`.
  - `POST /api/v1/fee-invoices/{id}:initiate-payment {return_path}`:
    - `fees.payment.pay-online`, with portal-readable permission classes via `get_permissions`;
    - flag `fees.online-payments`; an Idempotency-Key is required;
    - `return_path` must start with `/portal/`, and the absolute URL is built from the tenant's dashboard host;
    - reuse `account_link` if #159 has merged by then; otherwise add `core/tenancy/urls.py: tenant_app_url`
      here and leave #159 alone;
    - returns `{data: {payment_id, redirect_url}}`.
  - `POST /api/v1/public/payment-callbacks/{tenant_slug}/{callback_token}`.
  - `GET /api/v1/gateway-reconciliation-issues` and `POST …/{id}:resolve {action, note}` (`fees.gateway.manage`).

- [ ] **Failing tests:**
  - **Account and credentials:**
    - `test_credentials_are_write_only_and_masked`;
    - `test_credentials_stored_encrypted`.
  - **Initiation:**
    - `test_initiate_creates_pending_payment_for_available_balance`;
    - `test_initiate_returns_stored_redirect_when_adapter_cannot_reinitiate`;
    - `test_initiate_after_ttl_before_sweep_replaces_stale_pending`;
    - `test_initiate_provider_error_fails_payment_and_is_503`;
    - `test_initiate_without_account_is_409`;
    - `test_initiate_on_paid_invoice_is_409_nothing_due`;
    - `test_initiate_on_invoice_of_other_family_is_404`;
    - `test_other_tenant_invoice_is_404`;
    - `test_return_path_outside_portal_is_400`;
    - `test_initiate_requires_idempotency_key`;
    - `test_staff_cannot_initiate_for_guardian`;
    - `test_flag_off_is_403`.
  - **Callbacks:**
    - `test_paid_callback_confirms_issues_receipt_and_posts_ledger` (the receipt PDF renders with no actor);
    - `test_bad_signature_is_400_and_confirms_nothing`;
    - `test_stale_timestamp_is_400`;
    - `test_replayed_callback_confirms_once`;
    - `test_other_schools_signature_is_rejected`;
    - `test_unknown_token_is_404`;
    - `test_callback_for_inactive_account_still_applies`;
    - `test_failed_callback_marks_failed`;
    - `test_failed_callback_after_confirm_is_noop`.
  - **Money rules:**
    - `test_amount_mismatch_records_issue_without_confirming`;
    - `test_counter_payment_respects_pending_online`;
    - `test_late_paid_callback_after_expiry_confirms_and_flags_overpaid`;
    - `test_voucher_settlement_during_pending_online_posts_and_flags_overpaid`;
    - `test_confirm_failed_payment_refused_without_allow_failed`;
    - `test_expire_sweep_fails_stale_pending_only`.
  - **Issues:**
    - `test_resolve_book_at_gateway_amount_confirms_and_posts`;
    - `test_resolve_unknown_reference_books_new_payment`;
    - `test_resolve_dismiss_requires_note`;
    - `test_other_tenant_issue_resolve_is_404`.
  - **Audit:** `test_gateway_confirm_is_audited_with_system_actor`.
- [ ] **Finish:** regenerate the contract, then commit `feat(fees): online payment initiation and signed callbacks`.

### Task 3: Nightly reconciliation, docs, PR 1

**Files:**
- **Modify `apps/fees_finance/`:**
  - `services.py`: `reconcile_gateway_day(*, account, day) -> int`, the number of events applied plus issues
    opened, with the summary logged;
  - `tasks.py`: `reconcile_gateway_payments`, beat daily at `05:40` UTC, through `for_each_tenant`, `bulk`
    queue.
- **Rules:**
  - It covers every account with online payments in the window, active or not.
  - It fetches outside any transaction.
  - Each event is applied through `handle_gateway_event(source="reconcile")` in its own savepoint.
  - Our confirmed payment absent from the provider's list → `missing_at_gateway`.
  - Two provider transactions for one `order_id` → `duplicate_at_gateway`.
  - Open issues are never duplicated.
  - `GatewayUnavailable` skips that tenant and is logged.
- **Docs:** everything in Global Constraints, plus ADR-0034 and the runbook.
- **Test:** `test_gateway_reconciliation.py`:
  - `test_missed_callback_is_confirmed_by_reconciliation`;
  - `test_missing_at_gateway_opens_one_issue`;
  - `test_duplicate_at_gateway_opens_issue`;
  - `test_reconcile_is_idempotent`;
  - `test_one_event_failure_keeps_earlier_confirmations`;
  - `test_one_tenants_gateway_outage_does_not_stop_others`.
- [ ] **Finish:** commit `feat(fees): reconcile online payments nightly`. Then `change-reviewer`, fix, push,
  open PR 1, CI, then dispatch `e2e-live`.

  `e2e-live` adds `e2e/tests/live/api/online-payments.spec.ts`:
  - an admin sets up the fake account;
  - a guardian initiates;
  - the spec signs and posts a callback;
  - the receipt and ledger appear;
  - a replay changes nothing;
  - another tenant's slug is 404.

### Task 4 (PR 2, blocked): the real provider and the portal Pay button

**Start only when both are true:**
- the user has PayFast and Safepay sandbox credentials and has picked one;
- the portal stack (#156 → #158 → #160) has merged.

**First:** amend this plan from that provider's official API docs, including the session lifetime (to set
`PAYMENT_PENDING_TTL_MINUTES`), the signature scheme, the transaction query API and the re-initiate behaviour,
and run `plan-reviewer` again.

**What it adds:**
- **The adapter**, enabled in prod.
- **A Pay button** on `PortalInvoiceDetail`, shown with the key and the flag. It sends an Idempotency-Key, then
  redirects.
- **A result page** at `/portal/[studentId]/fees/[invoiceId]/payment-result`. It polls `GET /payments/{id}`;
  the callback decides the outcome, never the return URL.
- **A staff gateway settings screen and an issues screen**, including `:resolve`.
- **Copy** in `en` and `ur`; Jest; mocked E2E.

## Verification

- **PR 1:**
  - CI is green: `api` (RLS, cross-tenant, permission-key, endpoint-contract, env-example and throttle
    suites), `infra-terraform` and `repo-hygiene`.
  - `e2e-live` passes `online-payments.spec.ts`.
- **PR 2:**
  - a sandbox payment completes end to end, with the callback reaching us through a tunnel;
  - reconciliation runs against the sandbox.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-07
- **Verdict:** REVISE. The design was right (hosted checkout, signed callback, reuse of `confirm_payment`,
  slug+token resolution), but money and security details needed fixing.
- **Findings addressed:** all of them.
  - **Encryption key:** a fixed dev key shared by api and worker, plus the Terraform secret.
  - **Ids:** `order_id` versus `provider_txn_id`, with both constraints.
  - **Stale pending payments:** failed under the lock before a new one is created.
  - **Recovery:** booked resolutions (`book_at_gateway_amount` or `dismiss`).
  - **Failed payments:** confirmed only through the `allow_failed` guard.
  - **`fail_payment`:** pending only. Timestamped signatures handle replay and ordering.
  - **Locks and calls:** one lock order; provider calls outside locks and transactions; reconciliation
    savepoints.
  - **System actor:** for receipt rendering and audit.
  - **Inactive accounts:** still receive callbacks and are reconciled.
  - **Voucher settlement:** posts and raises `overpaid`.
  - **Throttles:** keyed on slug and token, plus a per-IP limit on failed signatures, with the env and test
    entries.
  - **Key rotation:** a command and a runbook.
  - **Fetch-to-verify:** `fetch_transaction`.
  - **Spec text:** §4, §11 and §2.6 amended in place.
  - **Masked id:** derived server-side.
  - **Re-initiation:** `can_reinitiate` and the `duplicate_at_gateway` issue.
  - **Reconciliation return type:** an int, matching `for_each_tenant`.
  - **Resource name:** pluralised.
  - **Cross-tenant:** the `:resolve` case.
  - **Suspended tenants:** callbacks are accepted and recorded.
  - **Fernet's tenant-binding limit:** recorded in ADR-0034.
  - **#159:** left alone.
- **Resolved by the user, 2026-11-07:**
  - (1) A settled voucher during a pending online payment posts and flags `overpaid`.
  - (2) Discrepancies are recovered with `book_at_gateway_amount` or `dismiss` plus a note.
  - (4) Editing the `.env.example` templates and the Terraform `api_secrets` names is approved.
- **Still open:** (3) The pending TTL is sized in the Task 4 amendment.
