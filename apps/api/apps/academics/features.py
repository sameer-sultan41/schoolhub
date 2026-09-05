from core.tenancy.features import registry

registry.register(
    "module.academics",
    "Academics (curriculum, teacher allocation, student promotion).",
    default_enabled=False,
)
