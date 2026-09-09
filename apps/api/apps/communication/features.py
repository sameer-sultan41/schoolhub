from core.tenancy.features import registry

registry.register(
    "module.communication",
    "Communication (announcements, notices, message threads, emergency broadcast, "
    "notification templates and preferences).",
    default_enabled=False,
)
