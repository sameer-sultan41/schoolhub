from core.tenancy.features import registry

registry.register(
    "module.examinations",
    "Examinations (exam setup, grading scales, marks, results, report cards).",
    default_enabled=False,
)
