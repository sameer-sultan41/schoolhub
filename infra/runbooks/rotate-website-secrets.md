# Runbook — Rotate the website renderer's secrets

**Purpose.** Replace the renderer's machine token, or the revalidation webhook secret, on a
schedule or because one may have leaked, without taking the public websites down.

**How it works.** Three Secrets Manager secrets per environment (Terraform variables in
`infra/terraform/envs/*/variables.tf`):

| Secret (proposed name) | Terraform variable | Holds | Read by |
| --- | --- | --- | --- |
| `schoolhub-<env>/website/machine-tokens` | `website_machine_tokens_arn` | every live renderer token, comma-separated, newest first | API, worker, beat (`WEBSITE_MACHINE_TOKENS`) |
| `schoolhub-<env>/website/machine-token` | `website_machine_token_arn` | the renderer's current token, which must be in the list | renderer (`WEBSITE_MACHINE_TOKEN`) |
| `schoolhub-<env>/website/revalidate-secret` | `website_revalidate_secret_arn` | the shared HMAC secret | API, worker (`WEBSITE_REVALIDATE_SECRET`) and renderer (`REVALIDATE_WEBHOOK_SECRET`) |

The API accepts any token in its list (`core/rbac/machine.py`), so the token rotates with
overlap: add the new one, move the renderer to it, then drop the old one.

**Never run `rotate-secrets.sh --rotate` on `*/website/machine-tokens`.** It writes one random
value, which would drop every live token, so every renderer read gets 401 and every site goes
dark. The script refuses it.

**Spec.** [`hosting-deployment.md`](../../docs/02-architecture/hosting-deployment.md) §5 and
[ADR-0039](../../docs/decisions/0039-public-content-api.md).

## Preconditions

- [ ] You can write the three secrets in the environment's Secrets Manager.
- [ ] You can redeploy the `api`, `celery-worker`, `celery-beat` and `website` services.
- [ ] Nobody else is rotating or deploying at the same time.
- [ ] If a value leaked: the incident is open ([`incident.md`](incident.md)).

## Steps — machine token

1. **Generate a token** on a trusted machine, e.g. `openssl rand -base64 48 | tr -d '\n=+/'`.
   Never paste it into a chat or a ticket.
2. **Add it to the front of the list** in `*/website/machine-tokens`: `new,old`. Edit the
   secret's value by hand (console or `aws secretsmanager put-secret-value`).
3. **Redeploy the API, worker and beat**, so every API task accepts both tokens.
4. **Set the renderer's secret** `*/website/machine-token` to the new token, then **redeploy the
   renderer**. Until its tasks restart they keep the old token, which the list still holds.
5. **Verify:** a tenant site renders (deploy runbook, Verification 4), and the API logs show no
   401 for the renderer.
6. **Remove the old token** from the list (`new` alone), then **redeploy the API, worker and
   beat**.

## Steps — revalidate secret

1. Run `./infra/scripts/rotate-secrets.sh --secret schoolhub-<env>/website/revalidate-secret --plan`
   to confirm the name and classification.
2. Write the new value to `*/website/revalidate-secret`.
3. **Redeploy the API, worker and renderer together.** While the two sides disagree, the
   renderer rejects webhooks (they fail closed) and published changes wait for the
   `CONTENT_REVALIDATE_SECONDS` (300 s) cache TTL, so staleness is bounded.
4. **Verify:** publish a small change on a test school and confirm it shows within seconds.

## Rollback

Every secret keeps its previous version as `AWSPREVIOUS`. Restore it and redeploy the same
services. For the token, putting the old token back at the front of the list is enough while
the renderer still holds it.
