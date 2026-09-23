from core.tenancy.features import registry

#: The one definition — every resource package's `services/` and `viewset.py`
#: import this rather than repeating the string literal. Lives here, not in
#: `permission_classes.py`, so a service function only needs this module (no
#: `rest_framework`/`core.rbac.permissions` import chain) to gate on the flag.
FEATURE = "module.communication"

registry.register(
    FEATURE,
    "Communication (announcements, notices, message threads, emergency broadcast, "
    "notification templates and preferences).",
    default_enabled=False,
)
