from core.tenancy.features import registry

#: The one definition; `views.py` imports it rather than repeating the literal.
FEATURE = "module.parent_portal"

registry.register(
    FEATURE,
    "Parent portal (the guardian and student dashboard over each module's own records).",
    default_enabled=False,
)
