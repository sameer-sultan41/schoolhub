"""Constants of the platform console (docs/03-modules/platform-admin.md)."""

# The resources of the console's `platform.<resource>.<action>` keys (§4). Every key on one of
# them is platform-scope. The tenant-side `platform.file`, `platform.job` and
# `platform.notification` keys share the module name only (ADR-0036).
PLATFORM_RESOURCES = ("tenant", "plan", "subscription", "feature-flag", "migration", "report")

# A tenant slug becomes the subdomain label `<slug>.<PLATFORM_DOMAIN>`: one DNS label of
# lowercase letters, digits and inner hyphens, 63 characters at most (platform-admin.md §11).
SLUG_PATTERN = r"^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$"

# Labels the website keeps for the platform's own hosts, so no school may take them. The
# website's copy is `RESERVED_LABELS` in apps/website/src/lib/host.ts; a test pins the two.
RESERVED_SLUGS = frozenset(
    {"www", "api", "app", "admin", "dashboard", "static", "cdn", "mail", "status"}
)

# The `background_jobs.job_type` of a full tenant export. A succeeded one, or an explicit
# waiver, is what lets `:delete` start the retention window of a school that ever went live.
TENANT_EXPORT_JOB_TYPE = "tenant_export"
