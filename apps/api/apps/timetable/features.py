from core.tenancy.features import registry

registry.register(
    "module.timetable",
    "Timetable (periods, rooms, the weekly grid, substitutions).",
    default_enabled=False,
)
