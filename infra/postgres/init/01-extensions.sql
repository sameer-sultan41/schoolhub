-- =============================================================================
-- 01-extensions.sql — extensions required by the SchoolHub schema.
--
-- Runs once, as the superuser, on an empty data directory (Docker's
-- /docker-entrypoint-initdb.d). To re-run locally:
--     docker compose down -v && docker compose up -d postgres
--
-- On a managed provider (RDS / Render / Railway) these are created by a
-- one-off migration or a provider console step instead; the set is identical.
--
-- Spec: docs/02-architecture/database-architecture.md §2
-- =============================================================================

\set ON_ERROR_STOP on

-- gen_random_uuid() for every UUID primary key, plus digest/crypt helpers used
-- for token hashing. Ships with PostgreSQL 18 core (contrib).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- uuid-ossp is NOT required for gen_random_uuid() on PostgreSQL 13+, but the
-- spec names it and some historical migrations reference uuid_generate_v4().
-- Keeping it costs nothing and avoids a restore failing on an old migration.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Case-insensitive text. Email addresses, tenant slugs and custom domains are
-- citext so that "Head@School.example" and "head@school.example" cannot both
-- exist, and so custom-domain lookup is not case-sensitive.
CREATE EXTENSION IF NOT EXISTS citext;

-- Trigram indexes for fuzzy name search (students, staff, guardians) before the
-- workload justifies a dedicated search engine. Postgres FTS + GIN covers the
-- rest per database-architecture.md §7.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Query statistics. Feeds the slow-query dashboards and the quarterly
-- unused-index review. Requires shared_preload_libraries=pg_stat_statements,
-- which compose/docker-compose.yml sets.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Deliberately NOT installed:
--   * postgres_fdw / dblink — cross-database access would route around RLS.
--   * pg_cron            — scheduled work belongs in Celery beat, where it is
--                          tenant-scoped, observable and retried.
