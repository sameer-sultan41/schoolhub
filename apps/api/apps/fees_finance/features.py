from core.tenancy.features import registry

registry.register(
    "module.fees_finance",
    "Fees & finance (fee configuration, invoicing, collection, ledger, expenses).",
    default_enabled=False,
)
