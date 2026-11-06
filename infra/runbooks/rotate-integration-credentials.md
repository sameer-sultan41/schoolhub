# Runbook — Rotate the integration credentials key

**Purpose.** Replace the key that encrypts each school's stored payment-gateway credentials
(`INTEGRATIONS_ENCRYPTION_KEYS`), on a schedule or because a key may have leaked, without any
school re-entering its credentials and without a moment where stored credentials cannot be read.

**How it works.** The setting is a comma-separated list of Fernet keys, **newest first**
(`apps/api/core/integrations/crypto.py`, `MultiFernet`). The first key encrypts; every key in the
list can decrypt. So rotation is: add the new key at the front, re-encrypt every row, then drop
the old key. That is Fernet's documented rotation mechanism.

**Spec.** [SEC-13](../../docs/06-security/security.md) (column encryption, rotation procedure
documented) and [ADR-0034](../../docs/decisions/0034-online-fee-payments.md).

## Preconditions

- [ ] You can write the `INTEGRATIONS_ENCRYPTION_KEYS` secret in the environment's secret store
      (the Terraform `integrations_encryption_keys_arn` secret in staging and production).
- [ ] You can run a one-off task with the API image (`manage.py`), as for migrations.
- [ ] Nobody else is rotating at the same time.
- [ ] If a key leaked: the incident is open ([`incident.md`](incident.md)). Rotation protects
      future dumps; it does not un-leak data already copied. Ask schools to rotate their merchant
      secrets with the provider too.

## Steps

1. **Generate a new key** on a trusted machine:

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Never paste it into a ticket, chat or log.

2. **Put it first in the list**, keeping the old key after it: `NEW,OLD`. Update the secret.

3. **Redeploy the `api` and `celery-worker` services** so both read the new list. They must
   agree: a worker still on the old list cannot decrypt a row the API just re-encrypted.
   Wait until every running task has the new value.

4. **Re-encrypt every tenant's rows** under the new key:

   ```bash
   python manage.py rotate_integration_credentials
   ```

   It runs tenant by tenant (`for_each_tenant`), including soft-deleted rows, and prints
   `Rotated N credential(s) across T tenant(s); F failure(s).` It is safe to re-run.

5. **If it reports any failure, stop.** It exits non-zero. Read the logs for the tenant and
   the cause, fix it, and run step 4 again. **Do not remove the old key while any failure
   remains**: a row still under the old key would become unreadable.

6. **Drop the old key.** Set the secret to `NEW` alone and redeploy `api` and `celery-worker`
   again.

## Verification

- [ ] Step 4's last run printed `0 failure(s)`.
- [ ] After step 6, `GET /api/v1/payment-gateway-accounts/current` for a school with an
      account returns its `merchant_id_masked`, and a test checkout (`:initiate-payment` in
      staging) reaches the provider. Both decrypt the credentials.
- [ ] No `InvalidToken` errors in the API or worker logs since step 6.

## Rollback

- **Before step 6:** nothing to undo. Both keys decrypt everything; leave the list as `NEW,OLD`
  until step 4 is clean.
- **After step 6, if decrypts fail:** put the old key back at the end (`NEW,OLD`) and redeploy.
  Every row is then readable again. Find the rows step 4 missed, re-run it, then retry step 6.
- **If every key is lost**, stored credentials cannot be recovered. Turn off
  `fees.online-payments` for the affected schools and ask each to re-enter its credentials at
  `PUT /payment-gateway-accounts/current`.
