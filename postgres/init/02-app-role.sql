-- =============================================================================
-- 02-app-role.sql — database roles for SchoolHub.
--
-- *** THIS IS THE MOST IMPORTANT FILE IN THIS REPOSITORY. ***
--
-- Tenant isolation is enforced by PostgreSQL Row-Level Security, not by
-- application code. RLS only binds to a role that is (a) not a superuser,
-- (b) does not have BYPASSRLS, and (c) is not the owner of the table.
--
--   THE APPLICATION ROLE MUST NOT HAVE BYPASSRLS AND MUST NOT OWN THE TABLES.
--
-- Break any one of those three and every RLS policy in the system silently
-- becomes a no-op: no error, no failing test, no log line — just every school's
-- data visible to every other school. That is why ownership is split:
--
--   schoolhub_migrator  — owns the schema and every table; runs migrations.
--                         Connects DIRECTLY to Postgres (5432), never through
--                         PgBouncer: DDL and CREATE INDEX CONCURRENTLY are
--                         session-scoped and incompatible with transaction
--                         pooling.
--   schoolhub_app       — what the running application connects as, through
--                         PgBouncer (6432). Owns nothing. No BYPASSRLS. No
--                         superuser. DML only. RLS binds to it.
--   schoolhub_readonly  — audited read-only role for platform-level aggregate
--                         reporting. Also no BYPASSRLS: platform reporting
--                         aggregates metrics, never row-level school data.
--
-- Even so, every tenant-owned table is created with BOTH `ENABLE ROW LEVEL
-- SECURITY` and `FORCE ROW LEVEL SECURITY` in its Django migration, so the
-- policy applies to the owner too and a future ownership mistake is contained.
--
-- Scope of this file: roles, database-level and schema-level grants, and the
-- default privileges that make future migrator-created tables reachable by the
-- app role. Per-table RLS policies live in Django migrations, so a database
-- restored from migrations alone is complete
-- (database-architecture.md §3).
--
-- Runs once, as the superuser, on an empty data directory. To run by hand
-- against a managed provider:
--
--   psql "$ADMIN_URL" \
--     -v ON_ERROR_STOP=1 \
--     -v app_user=schoolhub_app -v app_password='...' \
--     -v migration_user=schoolhub_migrator -v migration_password='...' \
--     -v readonly_user=schoolhub_readonly -v readonly_password='...' \
--     -f 02-app-role.sql
--
-- Spec: schoolhub-srd/docs/02-architecture/database-architecture.md §1
--       schoolhub-srd/docs/02-architecture/multi-tenancy.md §3
-- =============================================================================

\set ON_ERROR_STOP on

-- Read configuration from the environment (compose passes it), unless the caller
-- already supplied the variable with `psql -v`.
\if :{?app_user} \else \getenv app_user APP_DB_USER \endif
\if :{?app_password} \else \getenv app_password APP_DB_PASSWORD \endif
\if :{?migration_user} \else \getenv migration_user MIGRATION_DB_USER \endif
\if :{?migration_password} \else \getenv migration_password MIGRATION_DB_PASSWORD \endif
\if :{?readonly_user} \else \getenv readonly_user READONLY_DB_USER \endif
\if :{?readonly_password} \else \getenv readonly_password READONLY_DB_PASSWORD \endif

-- Role names have safe defaults; passwords deliberately do not.
\if :{?app_user} \else \set app_user 'schoolhub_app' \endif
\if :{?migration_user} \else \set migration_user 'schoolhub_migrator' \endif
\if :{?readonly_user} \else \set readonly_user 'schoolhub_readonly' \endif
\if :{?app_password} \else \set app_password '' \endif
\if :{?migration_password} \else \set migration_password '' \endif
\if :{?readonly_password} \else \set readonly_password '' \endif

DO $$
DECLARE
    v_app_user       text := :'app_user';
    v_app_password   text := :'app_password';
    v_mig_user       text := :'migration_user';
    v_mig_password   text := :'migration_password';
    v_ro_user        text := :'readonly_user';
    v_ro_password    text := :'readonly_password';
BEGIN
    IF coalesce(v_app_password, '') = ''
        OR coalesce(v_mig_password, '') = ''
        OR coalesce(v_ro_password, '') = '' THEN
        RAISE EXCEPTION
            'APP_DB_PASSWORD, MIGRATION_DB_PASSWORD and READONLY_DB_PASSWORD must all be set. '
            'Copy compose/.env.example to compose/.env and fill them in.';
    END IF;

    -- ---------------------------------------------------------------------
    -- Migration role — owns the schema and every table it creates.
    -- ---------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_mig_user) THEN
        EXECUTE format(
            'CREATE ROLE %I LOGIN PASSWORD %L '
            'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
            v_mig_user, v_mig_password);
    ELSE
        EXECUTE format(
            'ALTER ROLE %I LOGIN PASSWORD %L '
            'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
            v_mig_user, v_mig_password);
    END IF;

    -- ---------------------------------------------------------------------
    -- Application role — the one RLS must bind to.
    --
    -- NOBYPASSRLS is not decoration. `ALTER ROLE schoolhub_app BYPASSRLS` is a
    -- one-line, no-downtime, completely silent removal of the tenant boundary.
    -- Any change to this statement requires a security review.
    -- ---------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_app_user) THEN
        EXECUTE format(
            'CREATE ROLE %I LOGIN PASSWORD %L '
            'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
            v_app_user, v_app_password);
    ELSE
        EXECUTE format(
            'ALTER ROLE %I LOGIN PASSWORD %L '
            'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
            v_app_user, v_app_password);
    END IF;

    -- ---------------------------------------------------------------------
    -- Read-only role for audited platform-level aggregate queries.
    -- ---------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_ro_user) THEN
        EXECUTE format(
            'CREATE ROLE %I LOGIN PASSWORD %L '
            'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
            v_ro_user, v_ro_password);
    ELSE
        EXECUTE format(
            'ALTER ROLE %I LOGIN PASSWORD %L '
            'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
            v_ro_user, v_ro_password);
    END IF;

    -- ---------------------------------------------------------------------
    -- Database and schema grants.
    -- The public schema is owned by the migrator; nobody else may create in it.
    -- ---------------------------------------------------------------------
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I',
                   current_database(), v_mig_user);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), v_app_user);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), v_ro_user);

    EXECUTE format('ALTER SCHEMA public OWNER TO %I', v_mig_user);
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM PUBLIC';
    EXECUTE format('GRANT ALL ON SCHEMA public TO %I', v_mig_user);
    -- USAGE only: the app may read and write rows, never create or alter tables.
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_app_user);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_ro_user);

    -- ---------------------------------------------------------------------
    -- Default privileges: everything the migrator creates from now on is
    -- automatically reachable by the app and readonly roles — without either of
    -- them ever owning it. Without this, each migration would have to remember
    -- to GRANT, and a forgotten GRANT is a production outage.
    -- ---------------------------------------------------------------------
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
        v_mig_user, v_app_user);
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'GRANT USAGE, SELECT ON SEQUENCES TO %I',
        v_mig_user, v_app_user);
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'GRANT EXECUTE ON FUNCTIONS TO %I',
        v_mig_user, v_app_user);

    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'GRANT SELECT ON TABLES TO %I',
        v_mig_user, v_ro_user);

    -- Anything that already exists (an earlier bootstrap, a restored dump).
    EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
        v_app_user);
    EXECUTE format(
        'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', v_app_user);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', v_ro_user);
END
$$;

-- =============================================================================
-- Assertion. If any of these fail the database refuses to finish initializing,
-- which is exactly what we want: a silently-unprotected database is far worse
-- than one that will not start.
-- =============================================================================
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT rolname, rolsuper, rolbypassrls
        FROM pg_roles
        WHERE rolname IN (:'app_user', :'readonly_user')
    LOOP
        IF r.rolsuper THEN
            RAISE EXCEPTION 'Role % is a superuser; RLS would not bind.', r.rolname;
        END IF;
        IF r.rolbypassrls THEN
            RAISE EXCEPTION 'Role % has BYPASSRLS; RLS would not bind.', r.rolname;
        END IF;
    END LOOP;

    RAISE NOTICE
        'Roles ready: % (owner/migrations, direct 5432), % (application, via PgBouncer 6432, RLS-bound), % (audited read-only).',
        :'migration_user', :'app_user', :'readonly_user';
END
$$;
