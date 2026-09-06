from core.tenancy.features import registry

registry.register(
    "module.attendance",
    "Attendance (student and staff marking, corrections, leave).",
    default_enabled=False,
)
