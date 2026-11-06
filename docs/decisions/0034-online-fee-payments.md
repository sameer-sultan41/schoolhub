# 0034. Online fee payments go through the school's own merchant account, confirmed by a re-fetched callback and reconciled nightly

- **Status:** Accepted
- **Date:** 2026-11-07
- **Enforced by:** `apps/api/apps/fees_finance/tests/test_gateway_account.py` (credentials write-only, masked, stored encrypted); `test_online_payment_initiate.py` (the available balance, the TTL, a provider error failing the payment with 503, scope and flag); `test_payment_callback.py` (bad signature, stale timestamp, replay, another school's signature, unknown token, an inactive account still applying, out-of-order events, amount mismatch, late and voucher overpayments); `test_gateway_issues.py` (booked resolutions, dismiss needs a note); `test_gateway_reconciliation.py` (missed callback, `missing_at_gateway`, `duplicate_at_gateway`, idempotence, one bad event, one tenant's outage); `OnlinePaymentsCrossTenantTests` in `test_cross_tenant.py`; `apps/api/core/integrations/tests/` (Fernet rotation, the fake's signature); `apps/api/core/tenancy/tests/test_maintenance.py` (the non-atomic sweep); `apps/api/tests/test_throttle_rates.py` and `test_celery_routing.py`; `e2e/tests/live/api/online-payments.spec.ts`. The lock order and "no provider call inside a transaction" are review only

## Context

[fees-finance.md §17](../03-modules/fees-finance.md) asked for online fee payment "via the platform
integrations layer", and §20 recorded it as out of scope because no `core/integrations` existed.
The schema was ready (`payments.method = online_gateway`, `gateway_provider`, `gateway_payload`,
and `confirm_payment` split from `record_payment`), but nothing could confirm such a payment.

The user decided on 2026-11-07: Pakistan first, with one aggregator (PayFast or Safepay, chosen
after testing both sandboxes); **the school is the merchant of record**; a guardian pays the full
available balance only. The plan is
[`docs/superpowers/plans/2026-11-07-fee-online-payments.md`](../superpowers/plans/2026-11-07-fee-online-payments.md).
The industry reference for callbacks is Stripe's webhook guidance (signature plus timestamp
tolerance, ordering, duplicates, fetch-to-verify, a fast 2xx).

## Decision

1. **The school is the merchant of record.** Each school connects its own account with the
   aggregator. SchoolHub stores that school's credentials, and money never passes through a
   platform account.
2. **Credentials are encrypted at rest with `MultiFernet`** over `INTEGRATIONS_ENCRYPTION_KEYS`
   (comma-separated, newest first) in `core/integrations/crypto.py`, stored in a `BinaryField`.
   They are write-only through the API: the response carries `merchant_id_masked`, which the
   adapter derives server-side. Rotation is `manage.py rotate_integration_credentials`, which
   re-encrypts every tenant's rows through `for_each_tenant`
   ([runbook](../../infra/runbooks/rotate-integration-credentials.md)).
3. **Known limit: the ciphertext is not bound to a tenant.** Fernet has no associated data, so a
   ciphertext copied into another tenant's row would decrypt. Row-Level Security is the tenant
   boundary (invariant 1); the encryption protects dumps, replicas and backups. The
   `encrypt`/`decrypt` seam is where a KMS with an encryption context would replace it.
4. **SEC-15 is amended.** It said provider keys are "held platform-side only". That remains true
   for platform providers (LLM, SMS). Payment credentials are the school's own: write-only,
   encrypted, and only a server-derived mask is ever shown. See
   [security.md SEC-15](../06-security/security.md).
5. **The callback names its tenant in the URL.** `POST /api/v1/public/payment-callbacks/{tenant_slug}/{callback_token}`.
   The slug finds the tenant (`tenants` has no RLS). The view binds `tenant_atomic`, finds the
   account by token with a constant-time compare **whether or not the account is active** (a
   late callback for a payment taken before a provider switch still applies), verifies the
   signature and its timestamp with that account's secret, then **re-fetches the transaction
   from the provider** outside the transaction. The fetched transaction, not the callback body,
   is what is applied. A signed callback proves who sent it; the fetch proves the money moved.
   Responses: unknown slug or token `404`; bad signature or stale timestamp `400
   invalid_signature` plus a security event; anything valid, including duplicates and
   out-of-order events, `200`. Two throttles: `payment_callback` (600/min per slug and token)
   and `payment_callback_failure` (30 failures/min per IP).
6. **Two ids.** `order_id` is ours (`SH-{invoice_no}-{8 hex}`), stored in `reference_no` and used
   as the lookup key. `provider_txn_id` is the provider's, in its own column. Each is unique per
   tenant and provider among live `online_gateway` payments.
7. **A pending checkout holds the balance.** `available_balance = balance_due − pending online`.
   The cashier and a second checkout are refused past it (422 with
   `meta.pending_online_payment_id`). **Money already received always posts**: a late callback
   or a settled bank voucher confirms and raises an `overpaid` issue if it overpays. A pending
   checkout is failed after `PAYMENT_PENDING_TTL_MINUTES` by a 15-minute sweep.
8. **Every discrepancy is a booked issue, not a note.** `gateway_reconciliation_issues` holds
   `amount_mismatch`, `overpaid`, `unknown_reference`, `missing_at_gateway`, `paid_after_failed`
   and `duplicate_at_gateway`, one open per payment and kind. `:resolve` (`fees.gateway.manage`,
   audited) either `book_at_gateway_amount` (confirm at the verified amount, or create and
   confirm a payment for an unknown reference, with its receipt and ledger posting) or
   `dismiss` with a required note, such as "refunded at provider".
9. **Confirming a failed payment is explicit.** `confirm_payment(..., allow_failed=False)`; only
   the gateway path and a booked issue pass `True`.
10. **No provider call holds a lock or an open transaction.** Initiation commits the pending
    payment, then calls the provider, and fails the payment in a new transaction if the call
    errors. The callback verifies and fetches before its transaction. One lock order: invoice,
    then payment.
11. **A nightly reconciliation.** `reconcile_gateway_payments` (05:40 UTC, `bulk` queue) visits
    every tenant with `for_each_tenant(..., atomic=False)`. For each account with online
    payments in yesterday's window, active or not, it fetches the provider's list outside any
    transaction and applies each event through the callback's own `handle_gateway_event` in its
    own transaction. Our confirmed payment absent from the list, and not found paid by a direct
    lookup, is `missing_at_gateway`; two paid provider transactions for one order are
    `duplicate_at_gateway`. Open issues are never duplicated, so a re-run is safe. A provider
    outage skips that tenant and is logged.
12. **System actor.** Gateway and reconciliation confirmations have no user:
    `record_system_audit` records them with the order id and provider transaction id, and the
    receipt renders with no actor.
13. **Provider-agnostic adapter.** `core/integrations/payments` defines `PaymentAdapter`
    (initiate, verify a callback, fetch one transaction, list a day's) and a fake provider. A
    provider is usable only when registered and listed in `PAYMENT_PROVIDERS_ENABLED`: the fake
    in dev and test, none in production until the real adapter ships. The flag
    `fees.online-payments` is off by default.

## Alternatives considered

| Decision | Rejected | Why |
| --- | --- | --- |
| Merchant of record | A platform account with payouts to schools | It needs payment-facilitator licensing (user decision). |
| Credentials at rest | Plain `TenantSettings` JSON | Violates SEC-13. |
| Credentials at rest | A KMS | Not in the stack yet; the `encrypt`/`decrypt` seam takes it later. |
| SEC-15 | Platform-held provider keys | That is the rejected platform-account model. |
| Callback tenant resolution | The tenant in the body | Attacker-controlled input. |
| Callback tenant resolution | A global lookup by reference | Needs `all_tenants` on an unauthenticated route. |
| Ids | One mixed reference column | A callback keyed by the provider's id would never match our order. |
| Pending versus other payments | Blocking the cashier | The counter has to keep working. |
| Pending versus other payments | Sending a settled voucher to the exceptions queue | That money has already moved, the same argument as a late callback. |
| Recovering a discrepancy | `:resolve` sets a note only | Money would sit in the school's account with no payment, receipt or ledger entry. |
| Confirming a failed payment | Implicit | Any caller could confirm a failed payment. |
| Amount | Partial online payments | Deferred ([deferred-work.md](../deferred-work.md)). |
| Provider refunds | An adapter `refund` | Each aggregator differs; refunds stay on §7.3's manual flow. Deferred. |
| Reconciliation transaction | `for_each_tenant`'s per-tenant transaction | It would hold a transaction across the provider call. |

## Consequences

- A school sees online payment only after an owner or accountant saves its account and the flag
  is on. The portal Pay button, the staff gateway and issues screens and the real adapter are
  PR 2 of the plan, blocked on sandbox credentials and the portal stack.
- The callback URL is built from the request host (`build_absolute_uri`), which relies on
  production's `ALLOWED_HOSTS` and `SECURE_PROXY_SSL_HEADER`. An explicit API public URL
  setting is deferred.
- In dev only, `PAYMENT_FAKE_SETTLES_ON_INITIATE` makes the fake provider record a checkout as
  paid when it starts, so the live E2E lane's signed callback can be re-fetched. Tests leave it
  off.
- Losing every key in `INTEGRATIONS_ENCRYPTION_KEYS` makes stored credentials unreadable;
  schools would have to re-enter them. Never drop a key before the rotation command reports no
  failures.
