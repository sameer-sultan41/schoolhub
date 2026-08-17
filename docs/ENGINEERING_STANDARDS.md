# Engineering Standards — schoolhub-api

The standards this codebase is held to, and the authoritative documentation to
consult **before** writing code. Read the official docs rather than working from
memory: versions move faster than recall, and this repo pins current releases.

## 1. Authoritative References

Always check the version-matched page, not a search-engine result for an older release.

| Area | Reference |
| ---- | --------- |
| Python language & stdlib | https://docs.python.org/3/ |
| Python style (PEP 8) | https://peps.python.org/pep-0008/ |
| Type hints (PEP 484 / 585 / 604) | https://peps.python.org/pep-0484/ · https://docs.python.org/3/library/typing.html |
| Docstrings (PEP 257) | https://peps.python.org/pep-0257/ |
| Django 6.1 | https://docs.djangoproject.com/en/6.1/ |
| Django security topics | https://docs.djangoproject.com/en/6.1/topics/security/ |
| Django ORM optimization | https://docs.djangoproject.com/en/6.1/topics/db/optimization/ |
| Django migrations | https://docs.djangoproject.com/en/6.1/topics/migrations/ |
| Django REST Framework | https://www.django-rest-framework.org/ |
| SimpleJWT | https://django-rest-framework-simplejwt.readthedocs.io/ |
| drf-spectacular (OpenAPI) | https://drf-spectacular.readthedocs.io/ |
| Celery | https://docs.celeryq.dev/en/stable/ |
| psycopg 3 | https://www.psycopg.org/psycopg3/docs/ |
| PostgreSQL 18 | https://www.postgresql.org/docs/18/ |
| PostgreSQL Row-Level Security | https://www.postgresql.org/docs/18/ddl-rowsecurity.html |
| Ruff (lint + format) | https://docs.astral.sh/ruff/ |
| mypy | https://mypy.readthedocs.io/ |
| OWASP ASVS / Top 10 | https://owasp.org/www-project-application-security-verification-standard/ |

Product specification (what to build): https://github.com/sameer-sultan41/schoolhub-srd
Frontend counterparts: https://nextjs.org/docs · https://nextjs.org/docs/app/guides/ai-agents · https://vercel.com/docs/agent-resources/skills

## 2. Python Style

Follows PEP 8, enforced by Ruff (`pyproject.toml` → `[tool.ruff]`), not by review comments.

- **Line length 100.** Rule set: `E, F, I, UP, B, DJ, S, C4, RET, SIM` — pycodestyle, pyflakes, import sorting, pyupgrade, bugbear, Django-specific checks, bandit security, comprehensions, returns, simplify.
- **Type hints on every public function**, using modern syntax (`str | None`, `list[str]`), not `Optional`/`List`. `from __future__ import annotations` where forward references need it.
- **Docstrings (PEP 257)** on modules, classes, and any non-obvious function: state *why*, not a restatement of the signature.
- **Naming:** `snake_case` functions/variables, `PascalCase` classes, `UPPER_SNAKE` constants, `_leading_underscore` for module-private.
- **Prefer explicit over clever.** A comprehension that needs a comment should be a loop.
- **No bare `except:`.** Catch the narrowest exception that can actually occur; re-raise with `raise ... from exc` to preserve the chain.
- **f-strings** for interpolation, never `%` or `.format()` — except in logging calls, which use `%s` lazy formatting so unused messages cost nothing.

## 3. Django & DRF

- **Fat services, thin views.** Business logic lives in `services.py`; views handle HTTP concerns only. Serializers validate shape, services enforce rules.
- **Never `Model.objects.all()` on tenant-owned data.** The default manager is tenant-scoped; `all_tenants` is an explicit, greppable security decision.
- **Query discipline:** `select_related` for forward FKs, `prefetch_related` for reverse/M2M, `only`/`defer` on wide rows, `bulk_create`/`bulk_update` for batches. Any loop containing a query is an N+1 — fix it before review.
- **Migrations are separate from features** where practical, always reversible, and follow expand→migrate→contract for zero-downtime changes.
- **Every endpoint declares `required_permission`.** The permission class fails closed if one is missing.
- **Transactions:** `ATOMIC_REQUESTS` is on. Money and enrollment invariants use `select_for_update` inside an explicit `transaction.atomic()` block.
- **Idempotency** on money and outbound-effect endpoints via the `Idempotency-Key` header.

## 4. Security Non-Negotiables

Detailed requirements: `schoolhub-srd/docs/06-security/security.md`.

1. Tenant isolation is enforced by PostgreSQL RLS; the app role has neither `BYPASSRLS` nor table ownership.
2. Cross-tenant access returns **404**, never 403 — a 403 confirms the record exists.
3. No raw SQL without review; parameterize always. Never f-string a value into a query.
4. Secrets come from the environment. Nothing secret is committed, logged, or audited (see `_REDACTED_FIELDS`).
5. Children's PII is minimized everywhere and redacted before any AI provider call.
6. Audit every mutation; the audit table is append-only in Python *and* by database grant.

## 5. Testing

Full strategy: `schoolhub-srd/docs/07-quality/testing-strategy.md`.

- Django's test runner with `TestCase`/`APITestCase` — **PostgreSQL only**, never SQLite, because RLS cannot be exercised on another backend.
- Every new endpoint gets a **cross-tenant access test**; the shared harness auto-enrolls new routes so a missing test fails the build.
- RBAC matrix tests assert each permission key grants exactly what it should.
- Money tests assert ledger balance invariants.
- Coverage floor 80% overall (`fail_under` in `pyproject.toml`), ratcheted upward.

**Tests are not run locally.** Push and let CI report — CI is the source of truth for pass/fail.

## 6. Adding a Module

Each module in `apps/` mirrors one module doc in the specification repo.

1. Read `schoolhub-srd/docs/03-modules/<module>.md` (behavior) and the matching
   `docs/05-database/entities/<domain>.md` (schema).
2. `apps/<module>/` with `models.py`, `serializers.py`, `services.py`, `views.py`,
   `urls.py`, `permissions.py`, `filters.py`, `tests/`.
3. Models inherit `TenantOwnedModel`; the first migration calls
   `core.tenancy.rls.rls_operations("<table>", ...)` to attach the RLS policy.
4. `permissions.py` registers the module's keys from the doc's §4 table.
5. Register the app in `MODULE_APPS` and its routes in `config/api_v1.py`.
6. Ship with migrations, seeds, tests (including cross-tenant), OpenAPI annotations,
   and a feature flag.
